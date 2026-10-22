// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "common-hal/microcontroller/Pin.h"

#include "py/obj.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *scl_pin;
    const mcu_pin_obj_t *sda_pin;
    size_t timeout_ms;
    size_t frequency;
    int8_t port;
    bool has_lock;
} busio_i2c_obj_t;
