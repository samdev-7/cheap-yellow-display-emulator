// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <stdio.h>
#include <string.h>

#include "py/runtime.h"
#include "lib/oofatfs/ff.h"
#include "extmod/vfs_fat.h"
#include "supervisor/filesystem.h"
#include "supervisor/port.h"
#include "supervisor/shared/reload.h"

#include "background.h"
#include "wasm_hal.h"

#define PATH_MAX_LEN 256

static bool _applying;

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

static FRESULT _delete(FATFS *fatfs, const char *path) {
    FILINFO info;
    FRESULT res = f_stat(fatfs, path, &info);
    if (res != FR_OK) {
        return res == FR_NO_FILE ? FR_OK : res;
    }
    if (info.fattrib & AM_DIR) {
        FF_DIR dir;
        res = f_opendir(fatfs, &dir, path);
        char child[PATH_MAX_LEN];
        while (res == FR_OK) {
            res = f_readdir(&dir, &info);
            if (res != FR_OK || info.fname[0] == '\0') {
                break;
            }
            snprintf(child, sizeof(child), "%s/%s", path, info.fname);
            res = _delete(fatfs, child);
        }
        f_closedir(&dir);
        if (res != FR_OK) {
            return res;
        }
    }
    return f_unlink(fatfs, path);
}

void wasm_fs_apply_pending(bool trigger_reload) {
    if (_applying || !filesystem_present()) {
        return;
    }
    char path[PATH_MAX_LEN];
    uint32_t len;
    int kind = wasm_fs_next_op(path, sizeof(path), &len);
    if (kind == 0) {
        return;
    }
    _applying = true;
    FATFS *fatfs = &filesystem_circuitpy()->fatfs;
    int errors = 0;
    while (kind != 0) {
        FRESULT res = FR_OK;
        if (kind == 1) {
            res = _write_file(fatfs, path, len);
        } else if (kind == 2) {
            res = _make_parents(fatfs, path);
            if (res == FR_OK) {
                res = f_mkdir(fatfs, path);
                if (res == FR_EXIST) {
                    res = FR_OK;
                }
            }
        } else if (kind == 3) {
            res = _delete(fatfs, path);
        }
        if (res != FR_OK) {
            errors++;
        }
        kind = wasm_fs_next_op(path, sizeof(path), &len);
    }
    filesystem_flush();
    _applying = false;
    wasm_fs_ops_done(errors);
    if (trigger_reload) {
        autoreload_trigger();
    }
}
