// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "shared-bindings/socketpool/__init__.h"

#include "wasm_hal.h"

void socketpool_user_reset(void) {
    wasm_net_reset();
}
