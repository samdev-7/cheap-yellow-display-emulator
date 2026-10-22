// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "py/obj.h"

#include "common-hal/socketpool/Socket.h"
#include "common-hal/ssl/SSLContext.h"

typedef struct ssl_sslsocket_obj {
    mp_obj_base_t base;
    socketpool_socket_obj_t *sock;
    ssl_sslcontext_obj_t *ssl_context;
    bool closed;
} ssl_sslsocket_obj_t;
