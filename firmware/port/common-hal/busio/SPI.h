// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "shared-bindings/microcontroller/Pin.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *MOSI;
    const mcu_pin_obj_t *MISO;
    const mcu_pin_obj_t *clock;
    uint8_t host_id;
    uint8_t bits;
    uint8_t phase;
    uint8_t polarity;
    uint32_t baudrate;            // Actual frequency.
    uint32_t requested_baudrate;
    bool has_lock;
} busio_spi_obj_t;
