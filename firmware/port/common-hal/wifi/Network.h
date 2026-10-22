// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "py/obj.h"

typedef struct {
    mp_obj_base_t base;
    char ssid[33];
    uint8_t bssid[6];
    int8_t rssi;
    uint8_t channel;
    bool open; // Otherwise WPA2 with a password.
} wifi_network_obj_t;

mp_obj_t wifi_network_new(const char *ssid, const int32_t *info);
