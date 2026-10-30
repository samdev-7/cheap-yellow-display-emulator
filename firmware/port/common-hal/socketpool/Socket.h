// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "py/obj.h"

#include "common-hal/socketpool/SocketPool.h"

typedef struct {
    mp_obj_base_t base;
    int id;
    int type;
    int family;
    int proto;
    bool connected;
    socketpool_socketpool_obj_t *pool;
    mp_uint_t timeout_ms;
} socketpool_socket_obj_t;

mp_obj_t socketpool_address_tuple(uint32_t ip, uint32_t port);
