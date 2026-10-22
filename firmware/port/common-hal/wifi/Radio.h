// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "py/obj.h"

#include "shared-bindings/wifi/PowerManagement.h"
#include "shared-bindings/wifi/ScannedNetworks.h"

typedef struct {
    mp_obj_base_t base;
    wifi_scannednetworks_obj_t *current_scan;
    char hostname[64];
    uint8_t mac[6];
    uint8_t mac_ap[6];
    mp_float_t tx_power;
    wifi_power_management_t power_management;
    bool enabled;
    uint32_t static_address;
    uint32_t static_subnet;
    uint32_t static_gateway;
    uint32_t dns;
} wifi_radio_obj_t;
