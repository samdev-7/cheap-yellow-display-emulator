// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <string.h>

#include "shared-bindings/socketpool/Socket.h"
#include "shared-bindings/ssl/SSLContext.h"
#include "shared-bindings/ssl/SSLSocket.h"

#include "py/runtime.h"

#include "wasm_hal.h"

void common_hal_ssl_sslcontext_construct(ssl_sslcontext_obj_t *self) {
    self->check_hostname = true;
}

void common_hal_ssl_sslcontext_load_verify_locations(ssl_sslcontext_obj_t *self, const char *cadata) {
}

void common_hal_ssl_sslcontext_set_default_verify_paths(ssl_sslcontext_obj_t *self) {
}

bool common_hal_ssl_sslcontext_get_check_hostname(ssl_sslcontext_obj_t *self) {
    return self->check_hostname;
}

void common_hal_ssl_sslcontext_set_check_hostname(ssl_sslcontext_obj_t *self, bool value) {
    self->check_hostname = value;
}

void common_hal_ssl_sslcontext_load_cert_chain(ssl_sslcontext_obj_t *self, mp_buffer_info_t *cert_buf, mp_buffer_info_t *key_buf) {
}

ssl_sslsocket_obj_t *common_hal_ssl_sslcontext_wrap_socket(ssl_sslcontext_obj_t *self,
    mp_obj_t socket, bool server_side, const char *server_hostname) {
    if (server_side) {
        mp_raise_NotImplementedError(MP_ERROR_TEXT("Server side SSL isn't emulated"));
    }
    if (!mp_obj_is_type(socket, &socketpool_socket_type)) {
        mp_raise_TypeError(MP_ERROR_TEXT("Expected a socketpool.Socket"));
    }
    if (self->check_hostname && server_hostname == NULL) {
        mp_raise_ValueError(MP_ERROR_TEXT("check_hostname requires server_hostname"));
    }
    socketpool_socket_obj_t *sock = MP_OBJ_TO_PTR(socket);
    const char *hostname = server_hostname ? server_hostname : "";
    int result = wasm_net_set_tls(sock->id, hostname, strlen(hostname));
    if (result < 0) {
        mp_raise_OSError(-result);
    }
    ssl_sslsocket_obj_t *ssl_sock = mp_obj_malloc_with_finaliser(ssl_sslsocket_obj_t, &ssl_sslsocket_type);
    ssl_sock->sock = sock;
    ssl_sock->ssl_context = self;
    ssl_sock->closed = false;
    return ssl_sock;
}
