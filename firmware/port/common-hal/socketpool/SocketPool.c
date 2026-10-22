// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <stdio.h>
#include <string.h>

#include "shared/runtime/interrupt_char.h"

#include "common-hal/wifi/__init__.h"
#include "shared-bindings/socketpool/Socket.h"
#include "shared-bindings/socketpool/SocketPool.h"
#include "shared-bindings/wifi/__init__.h"

#include "py/mperrno.h"
#include "py/runtime.h"

#include "wasm_hal.h"

void common_hal_socketpool_socketpool_construct(socketpool_socketpool_obj_t *self, mp_obj_t radio) {
    if (radio != MP_OBJ_FROM_PTR(&common_hal_wifi_radio_obj)) {
        mp_raise_ValueError(MP_ERROR_TEXT("SocketPool can only be used with wifi.radio"));
    }
    wifi_ensure_init();
}

uint32_t socketpool_resolve(const char *host, size_t len) {
    wifi_ensure_init();
    uint32_t ip = 0;
    for (;;) {
        int result = wasm_net_lookup(host, len, &ip);
        if (result == 0) {
            return ip;
        }
        if (result != -MP_EINPROGRESS || mp_hal_is_interrupted()) {
            common_hal_socketpool_socketpool_raise_gaierror_noname();
        }
        RUN_BACKGROUND_TASKS;
        wasm_hal_idle(10);
    }
}

static mp_obj_t address_text(uint32_t ip) {
    char text[16];
    snprintf(text, sizeof(text), "%u.%u.%u.%u",
        (unsigned)(ip >> 24), (unsigned)((ip >> 16) & 0xff), (unsigned)((ip >> 8) & 0xff), (unsigned)(ip & 0xff));
    return mp_obj_new_str(text, strlen(text));
}

mp_obj_t socketpool_address_tuple(uint32_t ip, uint32_t port) {
    mp_obj_t items[2] = { address_text(ip), MP_OBJ_NEW_SMALL_INT(port) };
    return mp_obj_new_tuple(2, items);
}

mp_obj_t common_hal_socketpool_getaddrinfo_raise(socketpool_socketpool_obj_t *self, const char *host, int port, int family, int type, int proto, int flags) {
    if (family != 0 && family != SOCKETPOOL_AF_INET) {
        common_hal_socketpool_socketpool_raise_gaierror_noname();
    }
    uint32_t ip = socketpool_resolve(host, strlen(host));
    mp_obj_t entry[5] = {
        MP_OBJ_NEW_SMALL_INT(SOCKETPOOL_AF_INET),
        MP_OBJ_NEW_SMALL_INT(type),
        MP_OBJ_NEW_SMALL_INT(proto),
        MP_OBJ_NEW_QSTR(MP_QSTR_),
        socketpool_address_tuple(ip, port),
    };
    mp_obj_t result = mp_obj_new_list(0, NULL);
    mp_obj_list_append(result, mp_obj_new_tuple(5, entry));
    return result;
}
