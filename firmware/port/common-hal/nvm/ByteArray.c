// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "common-hal/nvm/ByteArray.h"
#include "shared-bindings/nvm/ByteArray.h"

#include "wasm_hal.h"

uint32_t common_hal_nvm_bytearray_get_length(const nvm_bytearray_obj_t *self) {
    return self->len;
}

bool common_hal_nvm_bytearray_set_bytes(const nvm_bytearray_obj_t *self,
    uint32_t start_index, uint8_t *values, uint32_t len) {
    wasm_nvm_write(start_index, values, len);
    return true;
}

void common_hal_nvm_bytearray_get_bytes(const nvm_bytearray_obj_t *self,
    uint32_t start_index, uint32_t len, uint8_t *values) {
    wasm_nvm_read(start_index, values, len);
}
