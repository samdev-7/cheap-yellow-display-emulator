// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "common-hal/microcontroller/Pin.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *pin;
    uint8_t timer_num;
    uint8_t channel;
    uint8_t duty_resolution;
    uint32_t duty;           // In timer counts, as ledc_get_duty() reports it.
    uint32_t clock_divider;  // 10.8 fixed point, as the LEDC timer stores it.
    bool variable_frequency : 1;
    bool deinited : 1;
} pwmio_pwmout_obj_t;
