// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <math.h>

#include "common-hal/pwmio/PWMOut.h"
#include "shared-bindings/pwmio/PWMOut.h"
#include "py/runtime.h"

#include "wasm_hal.h"

#define LEDC_TIMER_MAX 4
#define LEDC_CHANNEL_MAX 8
#define LEDC_TIMER_13_BIT 13
#define LEDC_TIMER_14_BIT 14
#define LEDC_FRACTIONAL_BITS 8
#define APB_CLK_FREQ 80000000

#define INDEX_EMPTY 0xFF

static uint32_t reserved_timer_freq[LEDC_TIMER_MAX];
static bool varfreq_timers[LEDC_TIMER_MAX];
static uint8_t reserved_channels[LEDC_CHANNEL_MAX] = { [0 ... LEDC_CHANNEL_MAX - 1] = INDEX_EMPTY};

static uint32_t calculate_duty_cycle(uint32_t frequency) {
    uint32_t duty_bits = 0;
    uint32_t interval = APB_CLK_FREQ / frequency;
    for (size_t i = 0; i < 32; i++) {
        if (!(interval >> i)) {
            duty_bits = i - 1;
            break;
        }
    }
    if (duty_bits >= LEDC_TIMER_14_BIT) {
        duty_bits = LEDC_TIMER_13_BIT;
    }
    return duty_bits;
}

static uint32_t _divider(uint32_t frequency, uint8_t duty_bits) {
    uint64_t precision = 1ull << duty_bits;
    return (((uint64_t)APB_CLK_FREQ << LEDC_FRACTIONAL_BITS) + ((frequency * precision) / 2)) / (frequency * precision);
}

static uint32_t _actual_frequency(pwmio_pwmout_obj_t *self) {
    uint64_t precision = 1ull << self->duty_resolution;
    return ((uint64_t)APB_CLK_FREQ << LEDC_FRACTIONAL_BITS) / (precision * self->clock_divider);
}

static void _update_output(pwmio_pwmout_obj_t *self) {
    uint32_t full = 1u << self->duty_resolution;
    uint16_t duty16 = self->duty >= full ? 0xffff : (uint16_t)((self->duty * 65536ull) / full);
    wasm_pwm_set(self->pin->number, duty16, _actual_frequency(self));
}

pwmout_result_t common_hal_pwmio_pwmout_construct(pwmio_pwmout_obj_t *self,
    const mcu_pin_obj_t *pin,
    uint16_t duty,
    uint32_t frequency,
    bool variable_frequency) {

    // check the frequency (avoid divide by zero below)
    if (frequency == 0) {
        return PWMOUT_INVALID_FREQUENCY;
    }

    // Calculate duty cycle
    uint32_t duty_bits = calculate_duty_cycle(frequency);
    if (duty_bits == 0) {
        return PWMOUT_INVALID_FREQUENCY;
    }

    if (pin->input_only) {
        return PWMOUT_INITIALIZATION_ERROR;
    }

    // Find a viable timer
    size_t timer_index = INDEX_EMPTY;
    size_t channel_index = INDEX_EMPTY;
    for (size_t i = 0; i < LEDC_TIMER_MAX; i++) {
        // accept matching freq timers unless this instance is varfreq or a prior one was
        if ((reserved_timer_freq[i] == frequency) && !variable_frequency && !varfreq_timers[i]) {
            // prioritize matched frequencies so we don't needlessly take slots
            timer_index = i;
            break;
        } else if (reserved_timer_freq[i] == 0) {
            timer_index = i;
            break;
        }
    }
    if (timer_index == INDEX_EMPTY) {
        return PWMOUT_INTERNAL_RESOURCES_IN_USE;
    }

    // Find a viable channel
    for (size_t i = 0; i < LEDC_CHANNEL_MAX; i++) {
        if (reserved_channels[i] == INDEX_EMPTY) {
            channel_index = i;
            break;
        }
    }
    if (channel_index == INDEX_EMPTY) {
        return PWMOUT_INTERNAL_RESOURCES_IN_USE;
    }

    // Make reservations
    reserved_timer_freq[timer_index] = frequency;
    reserved_channels[channel_index] = timer_index;
    if (variable_frequency) {
        varfreq_timers[timer_index] = true;
    }

    self->timer_num = timer_index;
    self->channel = channel_index;
    self->variable_frequency = variable_frequency;
    self->pin = pin;
    self->deinited = false;
    self->duty_resolution = duty_bits;
    self->clock_divider = _divider(frequency, duty_bits);
    claim_pin(pin);

    // Set initial duty
    common_hal_pwmio_pwmout_set_duty_cycle(self, duty);

    return PWMOUT_OK;
}

void common_hal_pwmio_pwmout_never_reset(pwmio_pwmout_obj_t *self) {
    never_reset_pin_number(self->pin->number);
}

bool common_hal_pwmio_pwmout_deinited(pwmio_pwmout_obj_t *self) {
    return self->deinited == true;
}

void common_hal_pwmio_pwmout_deinit(pwmio_pwmout_obj_t *self) {
    if (common_hal_pwmio_pwmout_deinited(self)) {
        return;
    }
    wasm_pwm_set(self->pin->number, 0, 0);
    reserved_channels[self->channel] = INDEX_EMPTY;
    // Search if any other channel is using the timer
    bool taken = false;
    for (size_t i = 0; i < LEDC_CHANNEL_MAX; i++) {
        if (reserved_channels[i] == self->timer_num) {
            taken = true;
            break;
        }
    }
    // Variable frequency means there's only one channel on the timer
    if (!taken || self->variable_frequency) {
        reserved_timer_freq[self->timer_num] = 0;
        // if timer isn't varfreq this will be off already
        varfreq_timers[self->timer_num] = false;
    }
    common_hal_reset_pin(self->pin);
    self->deinited = true;
}

void common_hal_pwmio_pwmout_set_duty_cycle(pwmio_pwmout_obj_t *self, uint16_t duty) {
    self->duty = duty >> (16 - self->duty_resolution);
    _update_output(self);
}

uint16_t common_hal_pwmio_pwmout_get_duty_cycle(pwmio_pwmout_obj_t *self) {
    return self->duty << (16 - self->duty_resolution);
}

void common_hal_pwmio_pwmout_set_frequency(pwmio_pwmout_obj_t *self, uint32_t frequency) {
    // Calculate duty cycle
    uint32_t duty_bits = calculate_duty_cycle(frequency);
    if (duty_bits == 0) {
        mp_arg_error_invalid(MP_QSTR_frequency);
    }
    self->duty_resolution = duty_bits;
    self->clock_divider = _divider(frequency, duty_bits);
    _update_output(self);
}

uint32_t common_hal_pwmio_pwmout_get_frequency(pwmio_pwmout_obj_t *self) {
    return _actual_frequency(self);
}

bool common_hal_pwmio_pwmout_get_variable_frequency(pwmio_pwmout_obj_t *self) {
    return self->variable_frequency;
}

const mcu_pin_obj_t *common_hal_pwmio_pwmout_get_pin(pwmio_pwmout_obj_t *self) {
    return self->pin;
}
