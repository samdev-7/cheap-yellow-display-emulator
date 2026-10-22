// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "common-hal/microcontroller/Pin.h"

#include "py/obj.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *rx_pin;
    const mcu_pin_obj_t *tx_pin;
    const mcu_pin_obj_t *rts_pin;
    const mcu_pin_obj_t *cts_pin;
    int8_t uart_num;
    uint8_t character_bits;
    uint32_t baudrate;
    uint32_t timeout_ms;
    bool is_console;
} busio_uart_obj_t;
