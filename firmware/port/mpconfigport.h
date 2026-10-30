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

// JS throttles the VM to an ESP32's speed from these counts: opcodes, VM
// entries, garbage collector steps, allocations, map lookups and prints.
extern uint32_t wasm_vm_counters[6];
#define MICROPY_VM_HOOK_OPCODE(op) (wasm_vm_counters[0]++)
#define MICROPY_VM_HOOK_INIT wasm_vm_counters[1]++;
#define MICROPY_GC_HOOK_LOOP(i) (wasm_vm_counters[2]++)
#define MICROPY_GC_HOOK_ALLOC() (wasm_vm_counters[3]++)
#define MICROPY_HOOK_MAP_LOOKUP() (wasm_vm_counters[4]++)
#define MICROPY_HOOK_PRINT() (wasm_vm_counters[5]++)

// gc.mem_free() after ESP-IDF and Wi-Fi start on an ESP32 without PSRAM.
#define WASM_PORT_HEAP_SIZE                 (160 * 1024)
