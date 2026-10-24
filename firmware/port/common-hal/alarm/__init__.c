// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <string.h>

#include "common-hal/alarm/__init__.h"
#include "shared-bindings/alarm/__init__.h"
#include "shared-bindings/alarm/SleepMemory.h"
#include "shared-bindings/alarm/pin/PinAlarm.h"
#include "shared-bindings/alarm/time/TimeAlarm.h"
#include "shared-bindings/microcontroller/__init__.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared-bindings/time/__init__.h"
#include "shared/runtime/interrupt_char.h"
#include "supervisor/port.h"

#include "py/gc.h"
#include "py/runtime.h"

#include "wasm_hal.h"

#define MAX_PIN_ALARMS 8

const alarm_sleep_memory_obj_t alarm_sleep_memory_obj = {
    .base = {
        .type = &alarm_sleep_memory_type,
    },
};

alarm_wake_alarm_union_t alarm_wake_alarm;

static bool _has_time_alarm;
static uint64_t _wake_at_ms;
static uint8_t _pins[MAX_PIN_ALARMS];
static uint8_t _values[MAX_PIN_ALARMS];
static size_t _pin_count;

static const mcu_pin_obj_t *_pin_by_number(uint32_t number) {
    const mp_map_t *map = &mcu_pin_globals.map;
    for (size_t i = 0; i < map->alloc; i++) {
        if (mp_map_slot_is_filled(map, i) && mp_obj_is_type(map->table[i].value, &mcu_pin_type)) {
            const mcu_pin_obj_t *pin = MP_OBJ_TO_PTR(map->table[i].value);
            if (pin->number == number) {
                return pin;
            }
        }
    }
    return NULL;
}

static bool _woken;

void alarm_reset(void) {
    _has_time_alarm = false;
    _pin_count = 0;
    _woken = false;
}

static bool _rtc_io(uint8_t pin) {
    static const uint8_t rtc[] = {0, 2, 4, 12, 13, 14, 15, 25, 26, 27, 32, 33, 34, 35, 36, 37, 38, 39};
    for (size_t i = 0; i < sizeof(rtc); i++) {
        if (rtc[i] == pin) {
            return true;
        }
    }
    return false;
}

static void _set_alarms(bool deep_sleep, size_t n_alarms, const mp_obj_t *alarms) {
    alarm_reset();
    size_t lows = 0;
    size_t highs = 0;
    for (size_t i = 0; i < n_alarms; i++) {
        if (mp_obj_is_type(alarms[i], &alarm_time_timealarm_type)) {
            if (_has_time_alarm) {
                mp_raise_ValueError(MP_ERROR_TEXT("Only one alarm.time alarm can be set."));
            }
            alarm_time_timealarm_obj_t *alarm = MP_OBJ_TO_PTR(alarms[i]);
            _has_time_alarm = true;
            _wake_at_ms = (uint64_t)(alarm->monotonic_time * 1000);
        } else if (mp_obj_is_type(alarms[i], &alarm_pin_pinalarm_type)) {
            alarm_pin_pinalarm_obj_t *alarm = MP_OBJ_TO_PTR(alarms[i]);
            if (deep_sleep && !_rtc_io(alarm->pin->number)) {
                mp_raise_ValueError(MP_ERROR_TEXT("Can only alarm on RTC IO from deep sleep."));
            }
            if (_pin_count < MAX_PIN_ALARMS) {
                _pins[_pin_count] = alarm->pin->number;
                _values[_pin_count] = alarm->value;
                _pin_count++;
            }
            if (alarm->value) {
                highs++;
            } else {
                lows++;
            }
        }
    }
    // ESP32 deep sleep wakes on one pin of either level (ext0) or a group all low or any high (ext1).
    if (deep_sleep && lows > 2) {
        mp_raise_ValueError(MP_ERROR_TEXT("Can only alarm on two low pins from deep sleep."));
    }
    if (deep_sleep && lows > 1 && highs > 0) {
        mp_raise_ValueError(MP_ERROR_TEXT("Can only alarm on one low pin while others alarm high from deep sleep."));
    }
}

static mp_obj_t _triggered(size_t n_alarms, const mp_obj_t *alarms) {
    uint64_t now = common_hal_time_monotonic_ms();
    for (size_t i = 0; i < n_alarms; i++) {
        if (mp_obj_is_type(alarms[i], &alarm_time_timealarm_type)) {
            alarm_time_timealarm_obj_t *alarm = MP_OBJ_TO_PTR(alarms[i]);
            if (now >= (uint64_t)(alarm->monotonic_time * 1000)) {
                return alarms[i];
            }
        } else if (mp_obj_is_type(alarms[i], &alarm_pin_pinalarm_type)) {
            alarm_pin_pinalarm_obj_t *alarm = MP_OBJ_TO_PTR(alarms[i]);
            if (wasm_gpio_get(alarm->pin->number) == alarm->value) {
                return alarms[i];
            }
        }
    }
    return mp_const_none;
}

mp_obj_t common_hal_alarm_light_sleep_until_alarms(size_t n_alarms, const mp_obj_t *alarms) {
    _set_alarms(false, n_alarms, alarms);
    mp_obj_t wake_alarm = mp_const_none;
    while (!mp_hal_is_interrupted()) {
        RUN_BACKGROUND_TASKS;
        wake_alarm = _triggered(n_alarms, alarms);
        if (wake_alarm != mp_const_none) {
            shared_alarm_save_wake_alarm(wake_alarm);
            break;
        }
        port_idle_until_interrupt();
    }
    alarm_reset();
    return wake_alarm;
}

void common_hal_alarm_set_deep_sleep_alarms(size_t n_alarms, const mp_obj_t *alarms, size_t n_dios, digitalio_digitalinout_obj_t **preserve_dios) {
    _set_alarms(true, n_alarms, alarms);
}

void MP_NORETURN common_hal_alarm_enter_deep_sleep(void) {
    int32_t time_ms = -1;
    if (_has_time_alarm) {
        uint64_t now = common_hal_time_monotonic_ms();
        time_ms = _wake_at_ms > now ? (int32_t)(_wake_at_ms - now) : 0;
    }
    wasm_alarm_deep_sleep(time_ms, _pins, _values, _pin_count);
    for (;;) {
        wasm_hal_idle(1000);
    }
}

void common_hal_alarm_pretending_deep_sleep(void) {
    while (!mp_hal_is_interrupted()) {
        RUN_BACKGROUND_TASKS;
        if (_has_time_alarm && common_hal_time_monotonic_ms() >= _wake_at_ms) {
            _woken = true;
            return;
        }
        for (size_t i = 0; i < _pin_count; i++) {
            if (wasm_gpio_get(_pins[i]) == _values[i]) {
                _woken = true;
                return;
            }
        }
        port_idle_until_interrupt();
    }
}

bool common_hal_alarm_woken_from_sleep(void) {
    return _woken;
}

mp_obj_t common_hal_alarm_record_wake_alarm(void) {
    uint32_t pin = 0;
    uint32_t value = 0;
    switch (wasm_alarm_wake(&pin, &value)) {
        case 1: {
            alarm_time_timealarm_obj_t *alarm = &alarm_wake_alarm.time_alarm;
            alarm->base.type = &alarm_time_timealarm_type;
            alarm->monotonic_time = 0.0f;
            return MP_OBJ_FROM_PTR(alarm);
        }
        case 2: {
            const mcu_pin_obj_t *woke = _pin_by_number(pin);
            if (woke == NULL) {
                return mp_const_none;
            }
            alarm_pin_pinalarm_obj_t *alarm = &alarm_wake_alarm.pin_alarm;
            alarm->base.type = &alarm_pin_pinalarm_type;
            alarm->pin = woke;
            alarm->value = value;
            alarm->pull = false;
            return MP_OBJ_FROM_PTR(alarm);
        }
        default:
            return mp_const_none;
    }
}

void common_hal_alarm_clear_pin_preservations(void) {
}

void common_hal_alarm_gc_collect(void) {
    gc_collect_ptr(shared_alarm_get_wake_alarm());
}
