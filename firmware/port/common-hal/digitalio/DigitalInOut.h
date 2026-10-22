// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "common-hal/microcontroller/Pin.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *pin;
    bool output_value;
    bool is_output : 1;
    bool open_drain : 1;
    uint8_t pull : 2;
} digitalio_digitalinout_obj_t;
