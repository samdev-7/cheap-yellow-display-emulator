// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "shared-bindings/wifi/Monitor.h"

#include "py/runtime.h"

void common_hal_wifi_monitor_construct(wifi_monitor_obj_t *self, uint8_t channel, size_t queue) {
    mp_raise_NotImplementedError(MP_ERROR_TEXT("wifi.Monitor isn't emulated"));
}

void common_hal_wifi_monitor_deinit(wifi_monitor_obj_t *self) {
}

bool common_hal_wifi_monitor_deinited(void) {
    return true;
}

void common_hal_wifi_monitor_set_channel(wifi_monitor_obj_t *self, uint8_t channel) {
}

mp_obj_t common_hal_wifi_monitor_get_channel(wifi_monitor_obj_t *self) {
    return mp_const_none;
}

mp_obj_t common_hal_wifi_monitor_get_queue(wifi_monitor_obj_t *self) {
    return mp_const_none;
}

mp_obj_t common_hal_wifi_monitor_get_lost(wifi_monitor_obj_t *self) {
    return MP_OBJ_NEW_SMALL_INT(0);
}

mp_obj_t common_hal_wifi_monitor_get_queued(wifi_monitor_obj_t *self) {
    return MP_OBJ_NEW_SMALL_INT(0);
}

mp_obj_t common_hal_wifi_monitor_get_packet(wifi_monitor_obj_t *self) {
    return mp_const_none;
}
