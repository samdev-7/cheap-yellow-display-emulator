// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "py/mphal.h"

#include "wasm_hal.h"

void mp_hal_delay_us(mp_uint_t delay) {
    double end = wasm_hal_now_us() + delay;
    double remaining;
    while ((remaining = end - wasm_hal_now_us()) > 0) {
        if (remaining >= 1000) {
            wasm_hal_idle((uint32_t)(remaining / 1000));
        }
    }
}
