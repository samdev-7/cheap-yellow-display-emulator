// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <string.h>

#include "shared-bindings/socketpool/Socket.h"
#include "shared-bindings/ssl/SSLSocket.h"

#include "py/runtime.h"

mp_obj_t common_hal_ssl_sslsocket_accept(ssl_sslsocket_obj_t *self) {
    mp_raise_NotImplementedError(MP_ERROR_TEXT("Server side SSL isn't emulated"));
}

void common_hal_ssl_sslsocket_bind(ssl_sslsocket_obj_t *self, mp_obj_t addr) {
    mp_raise_NotImplementedError(MP_ERROR_TEXT("Server side SSL isn't emulated"));
}

void common_hal_ssl_sslsocket_listen(ssl_sslsocket_obj_t *self, int backlog) {
    mp_raise_NotImplementedError(MP_ERROR_TEXT("Server side SSL isn't emulated"));
}

void common_hal_ssl_sslsocket_close(ssl_sslsocket_obj_t *self) {
    if (!self->closed) {
        common_hal_socketpool_socket_close(self->sock);
        self->closed = true;
    }
}

void common_hal_ssl_sslsocket_connect(ssl_sslsocket_obj_t *self, mp_obj_t addr) {
    mp_obj_t *items;
    mp_obj_get_array_fixed_n(addr, 2, &items);
    size_t hostlen;
    const char *host = mp_obj_str_get_data(items[0], &hostlen);
    common_hal_socketpool_socket_connect(self->sock, host, hostlen, mp_obj_get_int(items[1]));
}

bool common_hal_ssl_sslsocket_get_closed(ssl_sslsocket_obj_t *self) {
    return self->closed;
}

bool common_hal_ssl_sslsocket_get_connected(ssl_sslsocket_obj_t *self) {
    return !self->closed && common_hal_socketpool_socket_get_connected(self->sock);
}

bool common_hal_ssl_sslsocket_readable(ssl_sslsocket_obj_t *self) {
    return common_hal_socketpool_readable(self->sock);
}

bool common_hal_ssl_sslsocket_writable(ssl_sslsocket_obj_t *self) {
    return common_hal_socketpool_writable(self->sock);
}

mp_uint_t common_hal_ssl_sslsocket_recv_into(ssl_sslsocket_obj_t *self, uint8_t *buf, mp_uint_t len) {
    return common_hal_socketpool_socket_recv_into(self->sock, buf, len);
}

mp_uint_t common_hal_ssl_sslsocket_send(ssl_sslsocket_obj_t *self, const uint8_t *buf, mp_uint_t len) {
    return common_hal_socketpool_socket_send(self->sock, buf, len);
}

void common_hal_ssl_sslsocket_settimeout(ssl_sslsocket_obj_t *self, mp_obj_t timeout_obj) {
    mp_uint_t timeout_ms;
    if (timeout_obj == mp_const_none) {
        timeout_ms = (mp_uint_t)-1;
    } else {
        timeout_ms = (mp_uint_t)(mp_obj_get_float(timeout_obj) * 1000);
    }
    common_hal_socketpool_socket_settimeout(self->sock, timeout_ms);
}

void common_hal_ssl_sslsocket_setsockopt(ssl_sslsocket_obj_t *self, mp_obj_t level, mp_obj_t optname, mp_obj_t optval) {
}
