// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "shared-bindings/wifi/Network.h"
#include "shared-bindings/wifi/ScannedNetworks.h"

#include "py/runtime.h"

#include "wasm_hal.h"

mp_obj_t common_hal_wifi_scannednetworks_next(wifi_scannednetworks_obj_t *self) {
    if (self->done) {
        return mp_const_none;
    }
    char ssid[33];
    int32_t info[3];
    if (!wasm_wifi_scan(self->next, ssid, info)) {
        self->done = true;
        return mp_const_none;
    }
    self->next++;
    return wifi_network_new(ssid, info);
}
