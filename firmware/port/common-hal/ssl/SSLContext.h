// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "py/obj.h"

typedef struct {
    mp_obj_base_t base;
    bool check_hostname;
} ssl_sslcontext_obj_t;
