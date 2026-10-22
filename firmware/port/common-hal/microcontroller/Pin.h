// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "py/mphal.h"

#include "peripherals/pins.h"

#define PIN_BIT(pin_number) (((uint64_t)1) << pin_number)

extern void common_hal_reset_pin(const mcu_pin_obj_t *pin);
extern void common_hal_never_reset_pin(const mcu_pin_obj_t *pin);
extern void reset_all_pins(void);
extern void reset_pin_number(gpio_num_t pin_number);
extern void claim_pin(const mcu_pin_obj_t *pin);
extern void claim_pin_number(gpio_num_t pin_number);
extern bool pin_number_is_free(gpio_num_t pin_number);
extern void never_reset_pin_number(gpio_num_t pin_number);

extern bool espressif_board_reset_pin_number(gpio_num_t pin_number);
extern void config_pin_as_output_with_level(gpio_num_t pin_number, bool level);
