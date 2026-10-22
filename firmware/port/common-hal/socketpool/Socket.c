// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <stdio.h>
#include <string.h>

#include "shared/runtime/interrupt_char.h"

#include "shared-bindings/socketpool/Socket.h"
#include "shared-bindings/socketpool/SocketPool.h"
#include "supervisor/shared/tick.h"

#include "py/mperrno.h"
#include "py/runtime.h"

#include "wasm_hal.h"

#define BLOCK_FOREVER ((mp_uint_t)-1)

socketpool_socket_obj_t *common_hal_socketpool_socket(socketpool_socketpool_obj_t *self,
    socketpool_socketpool_addressfamily_t family, socketpool_socketpool_sock_t type, int proto) {
    if (family != SOCKETPOOL_AF_INET || (type != SOCKETPOOL_SOCK_STREAM && type != SOCKETPOOL_SOCK_DGRAM)) {
        mp_raise_NotImplementedError(MP_ERROR_TEXT("Unsupported socket type"));
    }
    socketpool_socket_obj_t *sock = mp_obj_malloc_with_finaliser(socketpool_socket_obj_t, &socketpool_socket_type);
    sock->id = wasm_net_socket(type == SOCKETPOOL_SOCK_DGRAM);
    sock->type = type;
    sock->family = family;
    sock->proto = proto;
    sock->connected = false;
    sock->pool = self;
    sock->timeout_ms = BLOCK_FOREVER;
    return sock;
}

static int wait(socketpool_socket_obj_t *self, int (*attempt)(socketpool_socket_obj_t *, void *), void *context) {
    uint64_t start = supervisor_ticks_ms64();
    for (;;) {
        int result = attempt(self, context);
        if (result != -MP_EAGAIN) {
            return result;
        }
        if (self->timeout_ms == 0) {
            return -MP_EAGAIN;
        }
        if (self->timeout_ms != BLOCK_FOREVER && supervisor_ticks_ms64() - start >= self->timeout_ms) {
            return -MP_ETIMEDOUT;
        }
        RUN_BACKGROUND_TASKS;
        if (mp_hal_is_interrupted()) {
            return -MP_EAGAIN;
        }
        wasm_hal_idle(10);
    }
}

typedef struct {
    uint8_t *buf;
    uint32_t len;
    uint32_t ip;
    uint32_t port;
} recv_args_t;

static int attempt_recv(socketpool_socket_obj_t *self, void *context) {
    recv_args_t *args = context;
    return wasm_net_recv(self->id, args->buf, args->len);
}

static int attempt_recvfrom(socketpool_socket_obj_t *self, void *context) {
    recv_args_t *args = context;
    return wasm_net_recvfrom(self->id, args->buf, args->len, &args->ip, &args->port);
}

static int attempt_accept(socketpool_socket_obj_t *self, void *context) {
    return -MP_EAGAIN;
}

static void check_open(socketpool_socket_obj_t *self) {
    if (self->id < 0) {
        mp_raise_OSError(MP_EBADF);
    }
}

socketpool_socket_obj_t *common_hal_socketpool_socket_accept(socketpool_socket_obj_t *self, mp_obj_t *peer_out) {
    check_open(self);
    int result = wait(self, attempt_accept, NULL);
    mp_raise_OSError(-result);
}

size_t common_hal_socketpool_socket_bind(socketpool_socket_obj_t *self, const char *host, size_t hostlen, uint32_t port) {
    check_open(self);
    return 0;
}

void common_hal_socketpool_socket_close(socketpool_socket_obj_t *self) {
    if (self->id >= 0) {
        wasm_net_close(self->id);
    }
    self->id = -1;
    self->connected = false;
}

void common_hal_socketpool_socket_connect(socketpool_socket_obj_t *self, const char *host, size_t hostlen, uint32_t port) {
    check_open(self);
    uint32_t ip = socketpool_resolve(host, hostlen);
    int result = wasm_net_connect(self->id, ip, port);
    if (result < 0) {
        mp_raise_OSError(-result);
    }
    self->connected = true;
}

bool common_hal_socketpool_socket_get_closed(socketpool_socket_obj_t *self) {
    return self->id < 0;
}

bool common_hal_socketpool_socket_get_connected(socketpool_socket_obj_t *self) {
    return self->connected;
}

mp_uint_t common_hal_socketpool_socket_get_timeout(socketpool_socket_obj_t *self) {
    return self->timeout_ms;
}

mp_int_t common_hal_socketpool_socket_get_type(socketpool_socket_obj_t *self) {
    return self->type;
}

bool common_hal_socketpool_socket_listen(socketpool_socket_obj_t *self, int backlog) {
    check_open(self);
    return true;
}

mp_uint_t common_hal_socketpool_socket_recvfrom_into(socketpool_socket_obj_t *self, uint8_t *buf, uint32_t len, mp_obj_t *peer_out) {
    check_open(self);
    recv_args_t args = { buf, len, 0, 0 };
    int result = wait(self, attempt_recvfrom, &args);
    if (result < 0) {
        mp_raise_OSError(-result);
    }
    *peer_out = socketpool_address_tuple(args.ip, args.port);
    return result;
}

int socketpool_socket_recv_into(socketpool_socket_obj_t *self, const uint8_t *buf, uint32_t len) {
    if (self->id < 0) {
        return -MP_EBADF;
    }
    recv_args_t args = { (uint8_t *)buf, len, 0, 0 };
    int result = wait(self, attempt_recv, &args);
    if (result == -MP_ENOTCONN || result == -MP_ECONNRESET || result == -MP_ECONNABORTED) {
        self->connected = false;
    }
    return result;
}

mp_uint_t common_hal_socketpool_socket_recv_into(socketpool_socket_obj_t *self, const uint8_t *buf, uint32_t len) {
    int result = socketpool_socket_recv_into(self, buf, len);
    if (result < 0) {
        mp_raise_OSError(-result);
    }
    return result;
}

int socketpool_socket_send(socketpool_socket_obj_t *self, const uint8_t *buf, uint32_t len) {
    if (self->id < 0) {
        return -MP_EBADF;
    }
    int result = wasm_net_send(self->id, buf, len);
    if (result == -MP_ENOTCONN || result == -MP_ECONNRESET || result == -MP_ECONNABORTED) {
        self->connected = false;
    }
    return result;
}

mp_uint_t common_hal_socketpool_socket_send(socketpool_socket_obj_t *self, const uint8_t *buf, uint32_t len) {
    int result = socketpool_socket_send(self, buf, len);
    if (result < 0) {
        mp_raise_OSError(-result);
    }
    return result;
}

mp_uint_t common_hal_socketpool_socket_sendto(socketpool_socket_obj_t *self,
    const char *host, size_t hostlen, uint32_t port, const uint8_t *buf, uint32_t len) {
    check_open(self);
    uint32_t ip = socketpool_resolve(host, hostlen);
    int result = wasm_net_sendto(self->id, ip, port, buf, len);
    if (result < 0) {
        mp_raise_BrokenPipeError();
    }
    return result;
}

void common_hal_socketpool_socket_settimeout(socketpool_socket_obj_t *self, uint32_t timeout_ms) {
    self->timeout_ms = timeout_ms;
}

int common_hal_socketpool_socket_setsockopt(socketpool_socket_obj_t *self, int level, int optname, const void *value, size_t optlen) {
    return 0;
}

bool common_hal_socketpool_readable(socketpool_socket_obj_t *self) {
    return self->id >= 0 && wasm_net_readable(self->id);
}

bool common_hal_socketpool_writable(socketpool_socket_obj_t *self) {
    return self->id >= 0 && self->connected;
}
