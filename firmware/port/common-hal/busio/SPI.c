// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <stdlib.h>
#include <string.h>

#include "py/mphal.h"
#include "py/runtime.h"
#include "shared-bindings/busio/SPI.h"
#include "shared-bindings/microcontroller/Pin.h"

#include "wasm_hal.h"

#define SPI2_HOST 1
#define SOC_SPI_PERIPH_NUM 3

static bool _host_in_use[SOC_SPI_PERIPH_NUM];

static int _cal_clock(int hz) {
    const int fapb = 80000000;
    if (hz > ((fapb / 4) * 3)) {
        return fapb;
    }
    int bestn = -1;
    int bestpre = -1;
    int besterr = 0;
    for (int n = 2; n <= 64; n++) {
        int pre = ((fapb / n) + (hz / 2)) / hz;
        if (pre <= 0) {
            pre = 1;
        }
        if (pre > 8192) {
            pre = 8192;
        }
        int errval = abs(fapb / (pre * n) - hz);
        if (bestn == -1 || errval <= besterr) {
            besterr = errval;
            bestn = n;
            bestpre = pre;
        }
    }
    return fapb / (bestpre * bestn);
}

static int _actual_freq(int target_hz) {
    return _cal_clock(target_hz) / 1000 * 1000;
}

static void set_spi_config(busio_spi_obj_t *self,
    uint32_t baudrate, uint8_t polarity, uint8_t phase, uint8_t bits) {
    int target = baudrate;
    int actual = _actual_freq(target);
    if (actual > (int)baudrate) {
        int lo = 1;
        int hi = baudrate;
        while (hi - lo > 1000) {
            int mid = lo + (hi - lo) / 2;
            int mid_actual = _actual_freq(mid);
            if (mid_actual <= (int)baudrate) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        target = lo;
    }
    self->baudrate = _actual_freq(target);
    self->requested_baudrate = baudrate;
    self->polarity = polarity;
    self->phase = phase;
    self->bits = bits;
    wasm_spi_config(self->clock->number,
        self->MOSI != NULL ? self->MOSI->number : NO_PIN,
        self->MISO != NULL ? self->MISO->number : NO_PIN,
        self->baudrate, polarity, phase);
}

static double _wire_busy_until_us;

static void _wait_for_wire(busio_spi_obj_t *self, size_t len) {
    double now = wasm_hal_now_us();
    if (_wire_busy_until_us < now) {
        _wire_busy_until_us = now;
    }
    _wire_busy_until_us += len * 8 * 1000000.0 / self->baudrate;
    double remaining = _wire_busy_until_us - now;
    if (remaining >= 50) {
        mp_hal_delay_us((mp_uint_t)remaining);
    }
}

void common_hal_busio_spi_construct(busio_spi_obj_t *self,
    const mcu_pin_obj_t *clock, const mcu_pin_obj_t *mosi,
    const mcu_pin_obj_t *miso, bool half_duplex) {
    // Ensure the object starts in its deinit state.
    common_hal_busio_spi_mark_deinit(self);

    if (half_duplex) {
        mp_raise_NotImplementedError_varg(MP_ERROR_TEXT("%q"), MP_QSTR_half_duplex);
    }

    self->host_id = 0;
    for (uint8_t host_id = SPI2_HOST; host_id < SOC_SPI_PERIPH_NUM; host_id++) {
        if (!_host_in_use[host_id]) {
            self->host_id = host_id;
        }
    }

    if (self->host_id == 0) {
        mp_raise_ValueError(MP_ERROR_TEXT("All SPI peripherals are in use"));
    }

    if ((mosi != NULL && mosi->input_only) || clock->input_only) {
        raise_ValueError_invalid_pins();
    }

    _host_in_use[self->host_id] = true;
    self->has_lock = false;
    self->MOSI = mosi;
    self->MISO = miso;
    self->clock = clock;
    set_spi_config(self, 250000, 0, 0, 8);

    if (mosi != NULL) {
        claim_pin(mosi);
    }
    if (miso != NULL) {
        claim_pin(miso);
    }
    claim_pin(clock);
}

void common_hal_busio_spi_never_reset(busio_spi_obj_t *self) {
    common_hal_never_reset_pin(self->clock);
    if (self->MOSI != NULL) {
        common_hal_never_reset_pin(self->MOSI);
    }
    if (self->MISO != NULL) {
        common_hal_never_reset_pin(self->MISO);
    }
}

bool common_hal_busio_spi_deinited(busio_spi_obj_t *self) {
    return self->clock == NULL;
}

void common_hal_busio_spi_mark_deinit(busio_spi_obj_t *self) {
    self->clock = NULL;
}

void common_hal_busio_spi_deinit(busio_spi_obj_t *self) {
    if (common_hal_busio_spi_deinited(self)) {
        return;
    }
    common_hal_reset_pin(self->clock);
    common_hal_busio_spi_mark_deinit(self);
    _host_in_use[self->host_id] = false;
    self->has_lock = false;
    common_hal_reset_pin(self->MOSI);
    common_hal_reset_pin(self->MISO);
}

bool common_hal_busio_spi_configure(busio_spi_obj_t *self,
    uint32_t baudrate, uint8_t polarity, uint8_t phase, uint8_t bits) {
    if (baudrate == self->requested_baudrate &&
        polarity == self->polarity &&
        phase == self->phase &&
        bits == self->bits) {
        return true;
    }
    set_spi_config(self, baudrate, polarity, phase, bits);
    return true;
}

bool common_hal_busio_spi_wait_for_lock(busio_spi_obj_t *self, uint32_t timeout_ms) {
    return common_hal_busio_spi_try_lock(self);
}

bool common_hal_busio_spi_try_lock(busio_spi_obj_t *self) {
    if (common_hal_busio_spi_deinited(self) || self->has_lock) {
        return false;
    }
    self->has_lock = true;
    return true;
}

bool common_hal_busio_spi_has_lock(busio_spi_obj_t *self) {
    return self->has_lock;
}

void common_hal_busio_spi_unlock(busio_spi_obj_t *self) {
    self->has_lock = false;
}

bool common_hal_busio_spi_write(busio_spi_obj_t *self,
    const uint8_t *data, size_t len) {
    if (self->MOSI == NULL) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("No %q pin"), MP_QSTR_mosi);
    }
    return common_hal_busio_spi_transfer(self, data, NULL, len);
}

bool common_hal_busio_spi_read(busio_spi_obj_t *self,
    uint8_t *data, size_t len, uint8_t write_value) {
    if (self->MISO == NULL) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("No %q pin"), MP_QSTR_miso);
    }
    if (self->MOSI == NULL) {
        return common_hal_busio_spi_transfer(self, NULL, data, len);
    } else {
        memset(data, write_value, len);
        return common_hal_busio_spi_transfer(self, data, data, len);
    }
}

bool common_hal_busio_spi_transfer(busio_spi_obj_t *self,
    const uint8_t *data_out, uint8_t *data_in, size_t len) {
    if (len == 0) {
        return true;
    }
    if (self->MOSI == NULL && data_out != NULL) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("No %q pin"), MP_QSTR_mosi);
    }
    if (self->MISO == NULL && data_in != NULL) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("No %q pin"), MP_QSTR_miso);
    }
    wasm_spi_transfer(self->clock->number, data_out, data_in, len, 0);
    _wait_for_wire(self, len);
    return true;
}

uint32_t common_hal_busio_spi_get_frequency(busio_spi_obj_t *self) {
    return self->baudrate;
}

uint8_t common_hal_busio_spi_get_phase(busio_spi_obj_t *self) {
    return self->phase;
}

uint8_t common_hal_busio_spi_get_polarity(busio_spi_obj_t *self) {
    return self->polarity;
}
