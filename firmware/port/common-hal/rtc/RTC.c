// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "py/obj.h"
#include "py/runtime.h"
#include "shared/timeutils/timeutils.h"
#include "shared-bindings/rtc/RTC.h"

#include "wasm_hal.h"

static int64_t _offset_s;

static int64_t _seconds_since_boot(void) {
    return (int64_t)(wasm_hal_now_us() / 1000000.0);
}

void common_hal_rtc_get_time(timeutils_struct_time_t *tm) {
    timeutils_seconds_since_2000_to_struct_time(_seconds_since_boot() + _offset_s, tm);
}

void common_hal_rtc_set_time(timeutils_struct_time_t *tm) {
    int64_t seconds = timeutils_seconds_since_2000(tm->tm_year, tm->tm_mon, tm->tm_mday, tm->tm_hour, tm->tm_min, tm->tm_sec);
    _offset_s = seconds - _seconds_since_boot();
}

int common_hal_rtc_get_calibration(void) {
    return 0;
}

void common_hal_rtc_set_calibration(int calibration) {
    mp_raise_NotImplementedError_varg(MP_ERROR_TEXT("%q"), MP_QSTR_calibration);
}
