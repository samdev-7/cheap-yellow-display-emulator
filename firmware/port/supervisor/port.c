// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <stdint.h>

#include <emscripten/stack.h>

#include "py/runtime.h"
#include "supervisor/background_callback.h"
#include "supervisor/board.h"
#include "supervisor/port.h"
#include "supervisor/shared/tick.h"
#include "shared/readline/readline.h"
#include "shared/runtime/interrupt_char.h"
#include "common-hal/microcontroller/Pin.h"
#include "shared-bindings/microcontroller/__init__.h"
#include "shared-bindings/rtc/__init__.h"
#include "shared-bindings/socketpool/__init__.h"
#include "shared-bindings/microcontroller/ResetReason.h"
#if CIRCUITPY_WATCHDOG
#include "common-hal/watchdog/WatchDogTimer.h"
#include "shared-module/watchdog/__init__.h"
#endif

#include "background.h"
#include "wasm_hal.h"

static uint32_t _port_heap[WASM_PORT_HEAP_SIZE / sizeof(uint32_t)];

static uint32_t _saved_word;

static bool _tick_enabled;
static uint64_t _last_tick;
static uint64_t _wake_at_tick;

uint32_t wasm_vm_opcodes;
uint32_t wasm_vm_calls;

safe_mode_t port_init(void) {
    _last_tick = port_get_raw_ticks(NULL);
    wasm_hal_vm_counters(&wasm_vm_opcodes, &wasm_vm_calls);
    return SAFE_MODE_NONE;
}

void reset_port(void) {
    wasm_fs_apply_pending();

    #if CIRCUITPY_RTC
    rtc_reset();
    #endif

    #if CIRCUITPY_SOCKETPOOL
    socketpool_user_reset();
    #endif

    #if CIRCUITPY_WATCHDOG
    watchdog_reset();
    #endif
}

void reset_to_bootloader(void) {
    wasm_hal_reset(1);
    for (;;) {
        wasm_hal_idle(1000);
    }
}

void reset_cpu(void) {
    wasm_hal_restart(MCU_RESET_REASON_SOFTWARE);
    for (;;) {
        wasm_hal_idle(1000);
    }
}

uint32_t *port_stack_get_limit(void) {
    return (uint32_t *)emscripten_stack_get_end();
}

uint32_t *port_stack_get_top(void) {
    return (uint32_t *)emscripten_stack_get_base();
}

uint32_t *port_heap_get_bottom(void) {
    return _port_heap;
}

uint32_t *port_heap_get_top(void) {
    return _port_heap + MP_ARRAY_SIZE(_port_heap);
}

void port_set_saved_word(uint32_t value) {
    _saved_word = value;
}

uint32_t port_get_saved_word(void) {
    return _saved_word;
}

uint64_t port_get_raw_ticks(uint8_t *subticks) {
    uint64_t subticks_total = (uint64_t)(wasm_hal_now_us() * 32768.0 / 1000000.0);
    if (subticks != NULL) {
        *subticks = subticks_total % 32;
    }
    return subticks_total / 32;
}

void port_enable_tick(void) {
    _tick_enabled = true;
    _last_tick = port_get_raw_ticks(NULL);
}

void port_disable_tick(void) {
    _tick_enabled = false;
}

void port_interrupt_after_ticks(uint32_t ticks) {
    _wake_at_tick = port_get_raw_ticks(NULL) + ticks;
}

static void _poll_interrupts(void) {
    if (mp_interrupt_char == CHAR_CTRL_C && wasm_serial_check_interrupt()) {
        mp_sched_keyboard_interrupt();
    }
    if (_tick_enabled) {
        uint64_t now = port_get_raw_ticks(NULL);
        if (now != _last_tick) {
            _last_tick = now;
            supervisor_tick();
        }
    }
    wasm_hal_background();
    #if CIRCUITPY_WATCHDOG
    watchdog_check();
    #endif
}

void port_idle_until_interrupt(void) {
    _poll_interrupts();
    if (background_callback_pending() || mp_hal_is_interrupted()) {
        return;
    }
    uint64_t now = port_get_raw_ticks(NULL);
    uint32_t timeout_ms = 1;
    if (!_tick_enabled && _wake_at_tick > now) {
        timeout_ms = (uint32_t)((_wake_at_tick - now) * 1000 / 1024);
        if (timeout_ms == 0) {
            timeout_ms = 1;
        }
    }
    wasm_hal_idle(timeout_ms);
    _poll_interrupts();
}

#define POLL_EVERY_OPCODES 1000
#define POLL_EVERY_CALLS 64

void port_background_task(void) {
    static uint32_t opcodes_at_poll;
    static uint32_t skipped;
    if (wasm_vm_opcodes - opcodes_at_poll < POLL_EVERY_OPCODES && ++skipped < POLL_EVERY_CALLS) {
        return;
    }
    opcodes_at_poll = wasm_vm_opcodes;
    skipped = 0;
    _poll_interrupts();
}

void port_background_tick(void) {
}

void port_start_background_tick(void) {
}

void port_finish_background_tick(void) {
}

void port_wake_main_task(void) {
}

void port_boot_info(void) {
}
