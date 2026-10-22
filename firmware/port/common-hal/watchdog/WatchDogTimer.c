// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "common-hal/watchdog/WatchDogTimer.h"
#include "shared-bindings/microcontroller/__init__.h"
#include "shared-bindings/microcontroller/ResetReason.h"
#include "shared-bindings/watchdog/__init__.h"
#include "supervisor/shared/tick.h"

#include "py/runtime.h"

#include "wasm_hal.h"

static void restart_deadline(watchdog_watchdogtimer_obj_t *self) {
    self->deadline_ms = supervisor_ticks_ms64() + (uint64_t)(self->timeout * 1000);
}

void common_hal_watchdog_feed(watchdog_watchdogtimer_obj_t *self) {
    restart_deadline(self);
}

void common_hal_watchdog_deinit(watchdog_watchdogtimer_obj_t *self) {
    self->mode = WATCHDOGMODE_NONE;
}

void common_hal_watchdog_set_timeout(watchdog_watchdogtimer_obj_t *self, mp_float_t new_timeout) {
    if ((uint64_t)new_timeout > UINT32_MAX / 1000) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("%q must be <= %u"), MP_QSTR_timeout, UINT32_MAX / 1000);
    }
    self->timeout = new_timeout;
    if (self->mode != WATCHDOGMODE_NONE) {
        restart_deadline(self);
    }
}

mp_float_t common_hal_watchdog_get_timeout(watchdog_watchdogtimer_obj_t *self) {
    return self->timeout;
}

watchdog_watchdogmode_t common_hal_watchdog_get_mode(watchdog_watchdogtimer_obj_t *self) {
    return self->mode;
}

void common_hal_watchdog_set_mode(watchdog_watchdogtimer_obj_t *self, watchdog_watchdogmode_t new_mode) {
    if (self->mode == new_mode) {
        return;
    }
    self->mode = new_mode;
    if (new_mode != WATCHDOGMODE_NONE) {
        restart_deadline(self);
    }
}

void watchdog_check(void) {
    watchdog_watchdogtimer_obj_t *self = &common_hal_mcu_watchdogtimer_obj;
    if (self->mode == WATCHDOGMODE_NONE || supervisor_ticks_ms64() < self->deadline_ms) {
        return;
    }
    if (self->mode == WATCHDOGMODE_RESET) {
        wasm_hal_restart(MCU_RESET_REASON_WATCHDOG);
    }
    self->mode = WATCHDOGMODE_NONE;
    mp_obj_exception_clear_traceback(MP_OBJ_FROM_PTR(&mp_watchdog_timeout_exception));
    MP_STATE_THREAD(mp_pending_exception) = &mp_watchdog_timeout_exception;
    #if MICROPY_ENABLE_SCHEDULER
    if (MP_STATE_VM(sched_state) == MP_SCHED_IDLE) {
        MP_STATE_VM(sched_state) = MP_SCHED_PENDING;
    }
    #endif
}
