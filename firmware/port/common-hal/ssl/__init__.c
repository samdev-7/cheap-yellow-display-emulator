// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "shared-bindings/ssl/__init__.h"
#include "shared-bindings/ssl/SSLContext.h"

void common_hal_ssl_create_default_context(ssl_sslcontext_obj_t *self) {
    common_hal_ssl_sslcontext_construct(self);
}
