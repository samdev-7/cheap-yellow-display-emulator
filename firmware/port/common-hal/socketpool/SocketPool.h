// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "py/obj.h"

typedef struct {
    mp_obj_base_t base;
} socketpool_socketpool_obj_t;

uint32_t socketpool_resolve(const char *host, size_t len);
