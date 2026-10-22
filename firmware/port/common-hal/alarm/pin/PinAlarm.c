// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "common-hal/alarm/pin/PinAlarm.h"
#include "shared-bindings/alarm/pin/PinAlarm.h"

#include "py/runtime.h"

void common_hal_alarm_pin_pinalarm_construct(alarm_pin_pinalarm_obj_t *self, const mcu_pin_obj_t *pin, bool value, bool edge, bool pull) {
    if (edge) {
        mp_raise_ValueError(MP_ERROR_TEXT("Cannot wake on pin edge. Only level."));
    }
    if (pull && pin->number >= 34) {
        mp_raise_ValueError(MP_ERROR_TEXT("Cannot pull on input-only pin."));
    }
    self->pin = pin;
    self->value = value;
    self->pull = pull;
}

const mcu_pin_obj_t *common_hal_alarm_pin_pinalarm_get_pin(alarm_pin_pinalarm_obj_t *self) {
    return self->pin;
}

bool common_hal_alarm_pin_pinalarm_get_value(alarm_pin_pinalarm_obj_t *self) {
    return self->value;
}

bool common_hal_alarm_pin_pinalarm_get_edge(alarm_pin_pinalarm_obj_t *self) {
    return false;
}

bool common_hal_alarm_pin_pinalarm_get_pull(alarm_pin_pinalarm_obj_t *self) {
    return self->pull;
}
