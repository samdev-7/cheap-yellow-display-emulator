// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <string.h>

#include "py/runtime.h"
#include "lib/oofatfs/ff.h"
#include "extmod/vfs_fat.h"
#include "supervisor/filesystem.h"
#include "supervisor/port.h"

#include "background.h"
#include "wasm_hal.h"

#define PATH_MAX_LEN 256

static FRESULT _make_parents(FATFS *fatfs, char *path) {
    for (char *p = path + 1; *p != '\0'; p++) {
        if (*p != '/') {
            continue;
        }
        *p = '\0';
        FRESULT res = f_mkdir(fatfs, path);
        *p = '/';
        if (res != FR_OK && res != FR_EXIST) {
            return res;
        }
    }
    return FR_OK;
}

static FRESULT _write_file(FATFS *fatfs, char *path, uint32_t len) {
    FRESULT res = _make_parents(fatfs, path);
    if (res != FR_OK) {
        return res;
    }
    uint8_t *data = port_malloc(len > 0 ? len : 1, false);
    if (data == NULL) {
        return FR_NOT_ENOUGH_CORE;
    }
    wasm_fs_op_data(data);
    FIL fp;
    res = f_open(fatfs, &fp, path, FA_WRITE | FA_CREATE_ALWAYS);
    if (res == FR_OK) {
        UINT written;
        res = f_write(&fp, data, len, &written);
        if (res == FR_OK && written != len) {
            res = FR_DENIED;
        }
        FRESULT close_res = f_close(&fp);
        if (res == FR_OK) {
            res = close_res;
        }
    }
    port_free(data);
    return res;
}

void wasm_fs_apply_pending(void) {
    if (!filesystem_present()) {
        return;
    }
    FATFS *fatfs = &filesystem_circuitpy()->fatfs;
    char path[PATH_MAX_LEN];
    uint32_t len;
    int errors = 0;
    while (wasm_fs_next_op(path, sizeof(path), &len)) {
        if (_write_file(fatfs, path, len) != FR_OK) {
            errors++;
        }
    }
    filesystem_flush();
    wasm_fs_ops_done(errors);
}
