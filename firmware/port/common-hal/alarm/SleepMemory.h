// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include "py/obj.h"

#define SLEEP_MEMORY_LENGTH (3 * 1024)

typedef struct {
    mp_obj_base_t base;
} alarm_sleep_memory_obj_t;
