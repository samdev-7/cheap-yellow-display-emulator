// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <stdio.h>
#include <string.h>

#include "shared/runtime/interrupt_char.h"

#include "common-hal/wifi/__init__.h"
#include "shared-bindings/wifi/Network.h"
#include "shared-bindings/wifi/Radio.h"
#include "shared-bindings/wifi/ScannedNetworks.h"
#include "shared-bindings/wifi/__init__.h"
#include "shared-bindings/time/__init__.h"
#include "supervisor/shared/tick.h"

#include "py/mphal.h"
#include "py/runtime.h"

#include "wasm_hal.h"

#define DHCP_ADDRESS 0xc0a8012a
#define DHCP_GATEWAY 0xc0a80101
#define DHCP_SUBNET 0xffffff00
#define AP_ADDRESS 0xc0a80401

static bool ap_active = false;

static uint32_t address(wifi_radio_obj_t *self) {
    return self->static_address ? self->static_address : DHCP_ADDRESS;
}

bool common_hal_wifi_radio_get_enabled(wifi_radio_obj_t *self) {
    return self->enabled;
}

void common_hal_wifi_radio_set_enabled(wifi_radio_obj_t *self, bool enabled) {
    self->enabled = enabled;
    if (!enabled) {
        wasm_wifi_disconnect();
        ap_active = false;
    }
}

mp_obj_t common_hal_wifi_radio_get_hostname(wifi_radio_obj_t *self) {
    return mp_obj_new_str(self->hostname, strlen(self->hostname));
}

void common_hal_wifi_radio_set_hostname(wifi_radio_obj_t *self, const char *hostname) {
    strncpy(self->hostname, hostname, sizeof(self->hostname) - 1);
    self->hostname[sizeof(self->hostname) - 1] = '\0';
}

mp_obj_t common_hal_wifi_radio_get_mac_address(wifi_radio_obj_t *self) {
    return mp_obj_new_bytes(self->mac, sizeof(self->mac));
}

void common_hal_wifi_radio_set_mac_address(wifi_radio_obj_t *self, const uint8_t *mac) {
    memcpy(self->mac, mac, sizeof(self->mac));
}

mp_obj_t common_hal_wifi_radio_get_mac_address_ap(wifi_radio_obj_t *self) {
    return mp_obj_new_bytes(self->mac_ap, sizeof(self->mac_ap));
}

void common_hal_wifi_radio_set_mac_address_ap(wifi_radio_obj_t *self, const uint8_t *mac) {
    memcpy(self->mac_ap, mac, sizeof(self->mac_ap));
}

mp_float_t common_hal_wifi_radio_get_tx_power(wifi_radio_obj_t *self) {
    return self->tx_power;
}

void common_hal_wifi_radio_set_tx_power(wifi_radio_obj_t *self, const mp_float_t power) {
    self->tx_power = power;
}

wifi_power_management_t common_hal_wifi_radio_get_power_management(wifi_radio_obj_t *self) {
    return self->power_management;
}

void common_hal_wifi_radio_set_power_management(wifi_radio_obj_t *self, wifi_power_management_t power_management) {
    self->power_management = power_management;
}

mp_obj_t common_hal_wifi_radio_start_scanning_networks(wifi_radio_obj_t *self, uint8_t start_channel, uint8_t stop_channel) {
    if (self->current_scan != NULL) {
        mp_raise_RuntimeError(MP_ERROR_TEXT("Already scanning for wifi networks"));
    }
    if (!self->enabled) {
        mp_raise_RuntimeError(MP_ERROR_TEXT("Wifi is not enabled"));
    }
    mp_hal_delay_ms(wasm_wifi_delay_ms(WASM_WIFI_DELAY_SCAN));
    wifi_scannednetworks_obj_t *scan = mp_obj_malloc(wifi_scannednetworks_obj_t, &wifi_scannednetworks_type);
    scan->next = 0;
    scan->done = false;
    self->current_scan = scan;
    return MP_OBJ_FROM_PTR(scan);
}

void common_hal_wifi_radio_stop_scanning_networks(wifi_radio_obj_t *self) {
    self->current_scan = NULL;
}

void common_hal_wifi_radio_start_station(wifi_radio_obj_t *self) {
}

void common_hal_wifi_radio_stop_station(wifi_radio_obj_t *self) {
    wasm_wifi_disconnect();
}

void common_hal_wifi_radio_start_ap(wifi_radio_obj_t *self, uint8_t *ssid, size_t ssid_len, uint8_t *password, size_t password_len, uint8_t channel, uint32_t authmode, uint8_t max_connections) {
    if (!self->enabled) {
        mp_raise_RuntimeError(MP_ERROR_TEXT("Wifi is not enabled"));
    }
    ap_active = true;
}

void common_hal_wifi_radio_stop_ap(wifi_radio_obj_t *self) {
    ap_active = false;
}

bool common_hal_wifi_radio_get_ap_active(wifi_radio_obj_t *self) {
    return ap_active;
}

mp_obj_t common_hal_wifi_radio_get_stations_ap(wifi_radio_obj_t *self) {
    return ap_active ? mp_obj_new_list(0, NULL) : mp_const_none;
}

void common_hal_wifi_radio_start_dhcp_client(wifi_radio_obj_t *self, bool ipv4, bool ipv6) {
    self->static_address = 0;
}

void common_hal_wifi_radio_stop_dhcp_client(wifi_radio_obj_t *self) {
}

void common_hal_wifi_radio_start_dhcp_server(wifi_radio_obj_t *self) {
}

void common_hal_wifi_radio_stop_dhcp_server(wifi_radio_obj_t *self) {
}

wifi_radio_error_t common_hal_wifi_radio_connect(wifi_radio_obj_t *self, uint8_t *ssid, size_t ssid_len, uint8_t *password, size_t password_len, uint8_t channel, mp_float_t timeout, uint8_t *bssid, size_t bssid_len) {
    if (!self->enabled) {
        mp_raise_RuntimeError(MP_ERROR_TEXT("Wifi is not enabled"));
    }
    uint32_t delay = wasm_wifi_delay_ms(WASM_WIFI_DELAY_JOIN);
    uint64_t start = supervisor_ticks_ms64();
    while (supervisor_ticks_ms64() - start < delay) {
        RUN_BACKGROUND_TASKS;
        if (mp_hal_is_interrupted()) {
            return WIFI_RADIO_ERROR_UNSPECIFIED;
        }
        wasm_hal_idle(20);
    }
    return (wifi_radio_error_t)wasm_wifi_connect((const char *)ssid, ssid_len);
}

bool common_hal_wifi_radio_get_connected(wifi_radio_obj_t *self) {
    return self->enabled && wasm_wifi_connected();
}

mp_obj_t common_hal_wifi_radio_get_ap_info(wifi_radio_obj_t *self) {
    if (!common_hal_wifi_radio_get_connected(self)) {
        return mp_const_none;
    }
    char ssid[33];
    int32_t info[3];
    wasm_wifi_ap_info(ssid, info);
    return wifi_network_new(ssid, info);
}

mp_obj_t common_hal_wifi_radio_get_ipv4_address(wifi_radio_obj_t *self) {
    return common_hal_wifi_radio_get_connected(self) ? wifi_ipv4_object(address(self)) : mp_const_none;
}

mp_obj_t common_hal_wifi_radio_get_ipv4_gateway(wifi_radio_obj_t *self) {
    if (!common_hal_wifi_radio_get_connected(self)) {
        return mp_const_none;
    }
    return wifi_ipv4_object(self->static_address ? self->static_gateway : DHCP_GATEWAY);
}

mp_obj_t common_hal_wifi_radio_get_ipv4_subnet(wifi_radio_obj_t *self) {
    if (!common_hal_wifi_radio_get_connected(self)) {
        return mp_const_none;
    }
    return wifi_ipv4_object(self->static_address ? self->static_subnet : DHCP_SUBNET);
}

mp_obj_t common_hal_wifi_radio_get_ipv4_dns(wifi_radio_obj_t *self) {
    if (!common_hal_wifi_radio_get_connected(self)) {
        return mp_const_none;
    }
    return wifi_ipv4_object(self->dns ? self->dns : DHCP_GATEWAY);
}

void common_hal_wifi_radio_set_ipv4_dns(wifi_radio_obj_t *self, mp_obj_t ipv4_dns_addr) {
    self->dns = wifi_ipv4_from_object(ipv4_dns_addr);
}

mp_obj_t common_hal_wifi_radio_get_ipv4_address_ap(wifi_radio_obj_t *self) {
    return ap_active ? wifi_ipv4_object(AP_ADDRESS) : mp_const_none;
}

mp_obj_t common_hal_wifi_radio_get_ipv4_gateway_ap(wifi_radio_obj_t *self) {
    return ap_active ? wifi_ipv4_object(AP_ADDRESS) : mp_const_none;
}

mp_obj_t common_hal_wifi_radio_get_ipv4_subnet_ap(wifi_radio_obj_t *self) {
    return ap_active ? wifi_ipv4_object(DHCP_SUBNET) : mp_const_none;
}

static mp_obj_t address_tuple(bool present, uint32_t value) {
    if (!present) {
        return mp_const_empty_tuple;
    }
    char text[16];
    snprintf(text, sizeof(text), "%u.%u.%u.%u",
        (unsigned)(value >> 24), (unsigned)((value >> 16) & 0xff), (unsigned)((value >> 8) & 0xff), (unsigned)(value & 0xff));
    mp_obj_t items[1] = { mp_obj_new_str(text, strlen(text)) };
    return mp_obj_new_tuple(1, items);
}

mp_obj_t common_hal_wifi_radio_get_addresses(wifi_radio_obj_t *self) {
    return address_tuple(common_hal_wifi_radio_get_connected(self), address(self));
}

mp_obj_t common_hal_wifi_radio_get_addresses_ap(wifi_radio_obj_t *self) {
    return address_tuple(ap_active, AP_ADDRESS);
}

mp_obj_t common_hal_wifi_radio_get_dns(wifi_radio_obj_t *self) {
    return address_tuple(common_hal_wifi_radio_get_connected(self), self->dns ? self->dns : DHCP_GATEWAY);
}

void common_hal_wifi_radio_set_dns(wifi_radio_obj_t *self, mp_obj_t dns_addr) {
    mp_obj_t *items;
    size_t len;
    mp_obj_get_array(dns_addr, &len, &items);
    self->dns = len > 0 ? wifi_ipv4_from_object(items[0]) : 0;
}

void common_hal_wifi_radio_set_ipv4_address(wifi_radio_obj_t *self, mp_obj_t ipv4, mp_obj_t netmask, mp_obj_t gateway, mp_obj_t ipv4_dns_addr) {
    self->static_address = wifi_ipv4_from_object(ipv4);
    self->static_subnet = wifi_ipv4_from_object(netmask);
    self->static_gateway = wifi_ipv4_from_object(gateway);
    if (ipv4_dns_addr != MP_OBJ_NULL && ipv4_dns_addr != mp_const_none) {
        self->dns = wifi_ipv4_from_object(ipv4_dns_addr);
    }
}

void common_hal_wifi_radio_set_ipv4_address_ap(wifi_radio_obj_t *self, mp_obj_t ipv4, mp_obj_t netmask, mp_obj_t gateway) {
}

mp_int_t common_hal_wifi_radio_ping(wifi_radio_obj_t *self, mp_obj_t ip_address, mp_float_t timeout) {
    if (!common_hal_wifi_radio_get_connected(self)) {
        return -1;
    }
    uint32_t delay = wasm_wifi_delay_ms(WASM_WIFI_DELAY_PING);
    mp_hal_delay_ms(delay);
    return delay ? delay : 20;
}
