// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "py/obj.h"
#include "driver/gpio.h"

typedef struct {
    mp_obj_base_t base;
    gpio_num_t number;
    bool has_adc : 1;
    bool has_dac : 1;
    bool input_only : 1;
} mcu_pin_obj_t;

extern const mp_obj_type_t mcu_pin_type;

#define NO_PIN (GPIO_NUM_NC)

#define PIN(p_number, p_adc, p_dac, p_input_only) \
    { \
        { &mcu_pin_type }, \
        .number = p_number, \
        .has_adc = p_adc, \
        .has_dac = p_dac, \
        .input_only = p_input_only, \
    }

#define GPIO0_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO0;
#define GPIO1_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO1;
#define GPIO2_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO2;
#define GPIO3_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO3;
#define GPIO4_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO4;
#define GPIO5_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO5;
#define GPIO6_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO6;
#define GPIO7_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO7;
#define GPIO8_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO8;
#define GPIO9_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO9;
#define GPIO10_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO10;
#define GPIO11_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO11;
#define GPIO12_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO12;
#define GPIO13_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO13;
#define GPIO14_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO14;
#define GPIO15_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO15;
#define GPIO16_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO16;
#define GPIO17_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO17;
#define GPIO18_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO18;
#define GPIO19_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO19;
#define GPIO20_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO20;
#define GPIO21_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO21;
#define GPIO22_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO22;
#define GPIO23_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO23;
#define GPIO25_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO25;
#define GPIO26_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO26;
#define GPIO27_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO27;
#define GPIO32_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO32;
#define GPIO33_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO33;
#define GPIO34_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO34;
#define GPIO35_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO35;
#define GPIO36_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO36;
#define GPIO37_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO37;
#define GPIO38_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO38;
#define GPIO39_EXISTS 1
extern const mcu_pin_obj_t pin_GPIO39;
