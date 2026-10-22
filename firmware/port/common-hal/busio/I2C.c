// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include "shared-bindings/busio/I2C.h"
#include "py/mperrno.h"
#include "py/mphal.h"
#include "py/runtime.h"

#include "shared-bindings/microcontroller/__init__.h"
#include "shared-bindings/microcontroller/Pin.h"

#include "wasm_hal.h"

#define SOC_HP_I2C_NUM 2

static bool _port_in_use[SOC_HP_I2C_NUM];

void common_hal_busio_i2c_construct(busio_i2c_obj_t *self,
    const mcu_pin_obj_t *scl, const mcu_pin_obj_t *sda, uint32_t frequency, uint32_t timeout_us) {
    // Ensure the object starts in its deinit state.
    common_hal_busio_i2c_mark_deinit(self);

    if (scl->input_only || sda->input_only) {
        raise_ValueError_invalid_pins();
    }

    #if CIRCUITPY_REQUIRE_I2C_PULLUPS
    wasm_gpio_config(sda->number, 1, 2);
    wasm_gpio_config(scl->number, 1, 2);
    common_hal_mcu_delay_us(10);
    wasm_gpio_config(sda->number, 1, 0);
    wasm_gpio_config(scl->number, 1, 0);
    common_hal_mcu_delay_us((1200000 + frequency - 1) / frequency);

    if (!wasm_gpio_get(sda->number) || !wasm_gpio_get(scl->number)) {
        reset_pin_number(sda->number);
        reset_pin_number(scl->number);
        mp_raise_RuntimeError(MP_ERROR_TEXT("No pull up found on SDA or SCL; check your wiring"));
    }
    #endif

    self->port = -1;
    for (int8_t port = 0; port < SOC_HP_I2C_NUM; port++) {
        if (!_port_in_use[port]) {
            self->port = port;
            break;
        }
    }
    if (self->port < 0) {
        mp_raise_ValueError(MP_ERROR_TEXT("All I2C peripherals are in use"));
    }
    _port_in_use[self->port] = true;

    self->sda_pin = sda;
    self->scl_pin = scl;
    self->has_lock = false;
    self->frequency = frequency;
    self->timeout_ms = 1000;

    claim_pin(sda);
    claim_pin(scl);
}

bool common_hal_busio_i2c_deinited(busio_i2c_obj_t *self) {
    return self->sda_pin == NULL;
}

void common_hal_busio_i2c_mark_deinit(busio_i2c_obj_t *self) {
    self->sda_pin = NULL;
}

void common_hal_busio_i2c_deinit(busio_i2c_obj_t *self) {
    if (common_hal_busio_i2c_deinited(self)) {
        return;
    }
    _port_in_use[self->port] = false;
    self->has_lock = false;
    common_hal_reset_pin(self->sda_pin);
    common_hal_reset_pin(self->scl_pin);
    common_hal_busio_i2c_mark_deinit(self);
}

bool common_hal_busio_i2c_probe(busio_i2c_obj_t *self, uint8_t addr) {
    return wasm_i2c_write(self->scl_pin->number, addr, NULL, 0) == 0;
}

bool common_hal_busio_i2c_try_lock(busio_i2c_obj_t *self) {
    if (common_hal_busio_i2c_deinited(self)) {
        return false;
    }
    if (self->has_lock) {
        return false;
    }
    self->has_lock = true;
    return self->has_lock;
}

bool common_hal_busio_i2c_has_lock(busio_i2c_obj_t *self) {
    return self->has_lock;
}

void common_hal_busio_i2c_unlock(busio_i2c_obj_t *self) {
    if (common_hal_busio_i2c_deinited(self)) {
        return;
    }
    self->has_lock = false;
}

mp_negative_errno_t common_hal_busio_i2c_write(busio_i2c_obj_t *self, uint16_t addr, const uint8_t *data, size_t len) {
    return wasm_i2c_write(self->scl_pin->number, addr, data, len);
}

mp_negative_errno_t common_hal_busio_i2c_read(busio_i2c_obj_t *self, uint16_t addr, uint8_t *data, size_t len) {
    return wasm_i2c_read(self->scl_pin->number, addr, data, len);
}

mp_negative_errno_t common_hal_busio_i2c_write_read(busio_i2c_obj_t *self, uint16_t addr,
    uint8_t *out_data, size_t out_len, uint8_t *in_data, size_t in_len) {
    mp_negative_errno_t result = wasm_i2c_write(self->scl_pin->number, addr, out_data, out_len);
    if (result != 0) {
        return result;
    }
    return wasm_i2c_read(self->scl_pin->number, addr, in_data, in_len);
}

void common_hal_busio_i2c_never_reset(busio_i2c_obj_t *self) {
    common_hal_never_reset_pin(self->scl_pin);
    common_hal_never_reset_pin(self->sda_pin);
}
