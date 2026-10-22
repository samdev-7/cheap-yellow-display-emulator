// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include <stdint.h>

#include "py/obj.h"

void wifi_ensure_init(void);

mp_obj_t wifi_ipv4_object(uint32_t address);
uint32_t wifi_ipv4_from_object(mp_obj_t address);
