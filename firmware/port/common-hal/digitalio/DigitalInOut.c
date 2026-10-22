// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "shared-bindings/digitalio/DigitalInOut.h"

#include "py/runtime.h"

#include "wasm_hal.h"

static void _apply(digitalio_digitalinout_obj_t *self) {
    uint8_t mode = 1;
    if (self->is_output) {
        mode = self->open_drain ? 3 : 2;
    }
    uint8_t pull = 0;
    if (self->pull == PULL_UP) {
        pull = 1;
    } else if (self->pull == PULL_DOWN) {
        pull = 2;
    }
    wasm_gpio_config(self->pin->number, mode, pull);
}

void common_hal_digitalio_digitalinout_never_reset(
    digitalio_digitalinout_obj_t *self) {
    never_reset_pin_number(self->pin->number);
}

digitalinout_result_t common_hal_digitalio_digitalinout_construct(
    digitalio_digitalinout_obj_t *self, const mcu_pin_obj_t *pin) {
    claim_pin(pin);
    self->pin = pin;
    self->output_value = false;
    self->is_output = false;
    self->open_drain = false;
    self->pull = PULL_NONE;
    _apply(self);
    return DIGITALINOUT_OK;
}

bool common_hal_digitalio_digitalinout_deinited(digitalio_digitalinout_obj_t *self) {
    return self->pin == NULL;
}

void common_hal_digitalio_digitalinout_deinit(digitalio_digitalinout_obj_t *self) {
    if (common_hal_digitalio_digitalinout_deinited(self)) {
        return;
    }
    reset_pin_number(self->pin->number);
    self->pin = NULL;
}

digitalinout_result_t common_hal_digitalio_digitalinout_switch_to_input(
    digitalio_digitalinout_obj_t *self, digitalio_pull_t pull) {
    self->pull = pull;
    self->is_output = false;
    _apply(self);
    return DIGITALINOUT_OK;
}

digitalinout_result_t common_hal_digitalio_digitalinout_switch_to_output(
    digitalio_digitalinout_obj_t *self, bool value,
    digitalio_drive_mode_t drive_mode) {
    common_hal_digitalio_digitalinout_set_value(self, value);
    return common_hal_digitalio_digitalinout_set_drive_mode(self, drive_mode);
}

digitalio_direction_t common_hal_digitalio_digitalinout_get_direction(
    digitalio_digitalinout_obj_t *self) {
    return self->is_output ? DIRECTION_OUTPUT : DIRECTION_INPUT;
}

void common_hal_digitalio_digitalinout_set_value(
    digitalio_digitalinout_obj_t *self, bool value) {
    self->output_value = value;
    wasm_gpio_set(self->pin->number, value);
}

bool common_hal_digitalio_digitalinout_get_value(
    digitalio_digitalinout_obj_t *self) {
    if (common_hal_digitalio_digitalinout_get_direction(self) == DIRECTION_INPUT) {
        return wasm_gpio_get(self->pin->number);
    }
    return self->output_value;
}

digitalinout_result_t common_hal_digitalio_digitalinout_set_drive_mode(
    digitalio_digitalinout_obj_t *self,
    digitalio_drive_mode_t drive_mode) {
    if (self->pin->input_only) {
        return DIGITALINOUT_INPUT_ONLY;
    }
    self->is_output = true;
    self->open_drain = drive_mode == DRIVE_MODE_OPEN_DRAIN;
    _apply(self);
    return DIGITALINOUT_OK;
}

digitalio_drive_mode_t common_hal_digitalio_digitalinout_get_drive_mode(
    digitalio_digitalinout_obj_t *self) {
    return self->open_drain ? DRIVE_MODE_OPEN_DRAIN : DRIVE_MODE_PUSH_PULL;
}

digitalinout_result_t common_hal_digitalio_digitalinout_set_pull(
    digitalio_digitalinout_obj_t *self, digitalio_pull_t pull) {
    self->pull = pull;
    _apply(self);
    return DIGITALINOUT_OK;
}

// ports/espressif reports PULL_UP whenever pull-down is off, even with no pull.
digitalio_pull_t common_hal_digitalio_digitalinout_get_pull(
    digitalio_digitalinout_obj_t *self) {
    return self->pull == PULL_DOWN ? PULL_DOWN : PULL_UP;
}
