// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <stdio.h>
#include <string.h>

#include "shared/runtime/interrupt_char.h"

#include "common-hal/wifi/__init__.h"
#include "shared-bindings/ipaddress/__init__.h"
#include "shared-bindings/ipaddress/IPv4Address.h"
#include "shared-bindings/wifi/__init__.h"
#include "shared-bindings/wifi/Radio.h"
#include "supervisor/shared/settings.h"

#include "py/gc.h"
#include "py/runtime.h"

#include "wasm_hal.h"

wifi_radio_obj_t common_hal_wifi_radio_obj;

static bool initialized = false;

void port_start_wifi(void) {
    wifi_ensure_init();
}

void common_hal_wifi_init(bool user_initiated) {
    (void)user_initiated;
    wifi_ensure_init();
}

void wifi_ensure_init(void) {
    if (initialized) {
        return;
    }
    initialized = true;
    wifi_radio_obj_t *self = &common_hal_wifi_radio_obj;
    self->base.type = &wifi_radio_type;
    self->enabled = true;
    self->tx_power = 20;
    self->power_management = POWER_MANAGEMENT_MIN;
    static const uint8_t mac[6] = {0x24, 0x0a, 0xc4, 0x02, 0x43, 0x59};
    memcpy(self->mac, mac, sizeof(mac));
    memcpy(self->mac_ap, mac, sizeof(mac));
    self->mac_ap[5] += 1;
    snprintf(self->hostname, sizeof(self->hostname), "cpy-%s-%02x%02x%02x%02x%02x%02x",
        CIRCUITPY_BOARD_ID, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    char custom[sizeof(self->hostname)];
    if (settings_get_str("CIRCUITPY_WIFI_HOSTNAME", custom, sizeof(custom)) == SETTINGS_OK) {
        strcpy(self->hostname, custom);
    }

    char ssid[33];
    if (settings_get_str("CIRCUITPY_WIFI_SSID", ssid, sizeof(ssid)) == SETTINGS_OK && ssid[0] != '\0') {
        wasm_wifi_set_home(ssid, strlen(ssid));
        common_hal_wifi_radio_connect(self, (uint8_t *)ssid, strlen(ssid), NULL, 0, 0, 0, NULL, 0);
    }
}

void wifi_user_reset(void) {
    wasm_net_reset();
}

void wifi_reset(void) {
    wasm_net_reset();
}

void common_hal_wifi_gc_collect(void) {
    gc_collect_ptr(common_hal_wifi_radio_obj.current_scan);
}

mp_obj_t wifi_ipv4_object(uint32_t address) {
    if (address == 0) {
        return mp_const_none;
    }
    return common_hal_ipaddress_new_ipv4address(__builtin_bswap32(address));
}

uint32_t wifi_ipv4_from_object(mp_obj_t address) {
    uint32_t packed = 0;
    if (mp_obj_is_str(address)) {
        size_t len;
        const char *text = mp_obj_str_get_data(address, &len);
        if (!ipaddress_parse_ipv4address(text, len, &packed)) {
            mp_raise_ValueError(MP_ERROR_TEXT("Not a valid IP string"));
        }
    } else if (mp_obj_is_type(address, &ipaddress_ipv4address_type)) {
        mp_obj_t bytes = common_hal_ipaddress_ipv4address_get_packed(MP_OBJ_TO_PTR(address));
        mp_buffer_info_t info;
        mp_get_buffer_raise(bytes, &info, MP_BUFFER_READ);
        memcpy(&packed, info.buf, 4);
    } else {
        mp_raise_TypeError(MP_ERROR_TEXT("Expected an IPv4Address"));
    }
    return __builtin_bswap32(packed);
}
