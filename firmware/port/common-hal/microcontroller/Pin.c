// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "shared-bindings/microcontroller/Pin.h"

#include "py/mphal.h"
#include "supervisor/board.h"

#include "wasm_hal.h"

static uint64_t _never_reset_pin_mask;
static uint64_t _in_use_pin_mask;

#define PIN_MASK_RESET_FORBIDDEN (PIN_BIT(6) | PIN_BIT(7) | PIN_BIT(8) | PIN_BIT(9) | PIN_BIT(10) | PIN_BIT(11))

MP_WEAK bool espressif_board_reset_pin_number(gpio_num_t pin_number) {
    return false;
}

void config_pin_as_output_with_level(gpio_num_t pin_number, bool level) {
    wasm_gpio_set(pin_number, level);
    wasm_gpio_config(pin_number, 2, 0);
}

static void _reset_pin(gpio_num_t pin_number) {
    if (PIN_MASK_RESET_FORBIDDEN & PIN_BIT(pin_number)) {
        return;
    }
    if (espressif_board_reset_pin_number(pin_number)) {
        return;
    }
    wasm_gpio_config(pin_number, 0, 0);
    wasm_pwm_set(pin_number, 0, 0);
}

void never_reset_pin_number(gpio_num_t pin_number) {
    if (pin_number == NO_PIN) {
        return;
    }
    _never_reset_pin_mask |= PIN_BIT(pin_number);
}

void common_hal_never_reset_pin(const mcu_pin_obj_t *pin) {
    if (pin == NULL) {
        return;
    }
    never_reset_pin_number(pin->number);
}

void reset_pin_number(gpio_num_t pin_number) {
    if (pin_number == NO_PIN) {
        return;
    }
    _never_reset_pin_mask &= ~PIN_BIT(pin_number);
    _in_use_pin_mask &= ~PIN_BIT(pin_number);
    _reset_pin(pin_number);
}

void common_hal_mcu_pin_reset_number(uint8_t i) {
    reset_pin_number((gpio_num_t)i);
}

void common_hal_reset_pin(const mcu_pin_obj_t *pin) {
    if (pin == NULL) {
        return;
    }
    reset_pin_number(pin->number);
}

void reset_all_pins(void) {
    for (uint8_t i = 0; i < 40; i++) {
        if (_never_reset_pin_mask & PIN_BIT(i)) {
            continue;
        }
        _reset_pin(i);
    }
    _in_use_pin_mask = _never_reset_pin_mask | PIN_MASK_RESET_FORBIDDEN;
}

void claim_pin_number(gpio_num_t pin_number) {
    if (pin_number == NO_PIN) {
        return;
    }
    _in_use_pin_mask |= PIN_BIT(pin_number);
}

void claim_pin(const mcu_pin_obj_t *pin) {
    claim_pin_number(pin->number);
}

void common_hal_mcu_pin_claim(const mcu_pin_obj_t *pin) {
    claim_pin(pin);
}

bool pin_number_is_free(gpio_num_t pin_number) {
    return !(_in_use_pin_mask & PIN_BIT(pin_number));
}

bool common_hal_mcu_pin_is_free(const mcu_pin_obj_t *pin) {
    return pin_number_is_free(pin->number);
}

uint8_t common_hal_mcu_pin_number(const mcu_pin_obj_t *pin) {
    return pin ? pin->number : NO_PIN;
}

void common_hal_mcu_pin_claim_number(uint8_t pin_no) {
    claim_pin_number(pin_no);
}
