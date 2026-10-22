// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "py/mpconfig.h"
#include "shared-bindings/os/__init__.h"

#include "wasm_hal.h"

bool common_hal_os_urandom(uint8_t *buffer, mp_uint_t length) {
    wasm_random_fill(buffer, length);
    return true;
}
