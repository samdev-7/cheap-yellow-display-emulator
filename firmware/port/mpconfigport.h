// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include <stdint.h>

#define MICROPY_PY_SYS_PLATFORM             "Espressif"
#define MICROPY_USE_INTERNAL_PRINTF         (0)
#define CIRCUITPY_DIGITALIO_HAVE_INPUT_ONLY (1)

#include "py/circuitpy_mpconfig.h"

#define MICROPY_NLR_SETJMP                  (1)
#define CIRCUITPY_DEFAULT_STACK_SIZE        0x6000
#define MICROPY_ALLOC_GC_STACK_SIZE         (128)

#ifndef CIRCUITPY_I2C_ALLOW_INTERNAL_PULL_UP
#define CIRCUITPY_I2C_ALLOW_INTERNAL_PULL_UP (0)
#endif

#define CALLBACK_CRITICAL_BEGIN
#define CALLBACK_CRITICAL_END

#define INTERNAL_FLASH_FILESYSTEM_SIZE      (1216 * 1024)

#define CIRCUITPY_INTERNAL_NVM_SIZE         (8 * 1024)

extern uint32_t wasm_vm_opcodes;
extern uint32_t wasm_vm_calls;
#define MICROPY_VM_HOOK_OPCODE(op) do { \
        wasm_vm_opcodes++; \
        if ((uint8_t)((op) - 0x34) < 4) { \
            wasm_vm_calls++; \
        } \
} while (0)

#define WASM_PORT_HEAP_SIZE                 (160 * 1024)
