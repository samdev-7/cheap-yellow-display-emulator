// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "supervisor/internal_flash.h"

#include <string.h>

#include "py/runtime.h"
#include "supervisor/flash.h"
#include "supervisor/shared/internal_flash.h"

static uint8_t _flash[INTERNAL_FLASH_FILESYSTEM_SIZE];
static bool _flash_loaded;

void supervisor_flash_init(void) {
    if (_flash_loaded) {
        return;
    }
    memset(_flash, 0xff, sizeof(_flash));
    _flash_loaded = true;
}

uint32_t supervisor_flash_get_block_size(void) {
    return FILESYSTEM_BLOCK_SIZE;
}

uint32_t supervisor_flash_get_block_count(void) {
    return INTERNAL_FLASH_FILESYSTEM_SIZE / FILESYSTEM_BLOCK_SIZE;
}

void port_internal_flash_flush(void) {
}

mp_uint_t supervisor_flash_read_blocks(uint8_t *dest, uint32_t block, uint32_t num_blocks) {
    uint32_t offset = block * FILESYSTEM_BLOCK_SIZE;
    uint32_t len = num_blocks * FILESYSTEM_BLOCK_SIZE;
    if (offset + len > sizeof(_flash)) {
        return 1;
    }
    memcpy(dest, _flash + offset, len);
    return 0;
}

mp_uint_t supervisor_flash_write_blocks(const uint8_t *src, uint32_t block, uint32_t num_blocks) {
    uint32_t offset = block * FILESYSTEM_BLOCK_SIZE;
    uint32_t len = num_blocks * FILESYSTEM_BLOCK_SIZE;
    if (offset + len > sizeof(_flash)) {
        return 1;
    }
    memcpy(_flash + offset, src, len);
    return 0;
}

void supervisor_flash_release_cache(void) {
}
