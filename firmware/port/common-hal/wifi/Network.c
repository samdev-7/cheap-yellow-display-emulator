// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <string.h>

#include "shared-bindings/wifi/AuthMode.h"
#include "shared-bindings/wifi/Network.h"

#include "py/enum.h"
#include "py/runtime.h"

mp_obj_t wifi_network_new(const char *ssid, const int32_t *info) {
    wifi_network_obj_t *self = mp_obj_malloc(wifi_network_obj_t, &wifi_network_type);
    strncpy(self->ssid, ssid, sizeof(self->ssid) - 1);
    self->rssi = info[0];
    self->channel = info[1];
    self->open = info[2] == 0;
    uint32_t hash = 5381;
    for (const char *c = ssid; *c; c++) {
        hash = hash * 33 + (uint8_t)*c;
    }
    const uint8_t bssid[6] = {0x02, 0x1a, (uint8_t)(hash >> 24), (uint8_t)(hash >> 16), (uint8_t)(hash >> 8), (uint8_t)hash};
    memcpy(self->bssid, bssid, sizeof(bssid));
    return MP_OBJ_FROM_PTR(self);
}

mp_obj_t common_hal_wifi_network_get_ssid(wifi_network_obj_t *self) {
    return mp_obj_new_str(self->ssid, strlen(self->ssid));
}

mp_obj_t common_hal_wifi_network_get_bssid(wifi_network_obj_t *self) {
    return mp_obj_new_bytes(self->bssid, sizeof(self->bssid));
}

mp_obj_t common_hal_wifi_network_get_rssi(wifi_network_obj_t *self) {
    return mp_obj_new_int(self->rssi);
}

mp_obj_t common_hal_wifi_network_get_channel(wifi_network_obj_t *self) {
    return mp_obj_new_int(self->channel);
}

mp_obj_t common_hal_wifi_network_get_country(wifi_network_obj_t *self) {
    return MP_OBJ_NEW_QSTR(MP_QSTR_US);
}

mp_obj_t common_hal_wifi_network_get_authmode(wifi_network_obj_t *self) {
    mp_obj_t modes = mp_obj_new_list(0, NULL);
    if (self->open) {
        mp_obj_list_append(modes, cp_enum_find(&wifi_authmode_type, AUTHMODE_OPEN));
    } else {
        mp_obj_list_append(modes, cp_enum_find(&wifi_authmode_type, AUTHMODE_WPA2));
        mp_obj_list_append(modes, cp_enum_find(&wifi_authmode_type, AUTHMODE_PSK));
    }
    return modes;
}
