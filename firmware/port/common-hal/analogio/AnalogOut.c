// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <stdint.h>

#include "py/runtime.h"
#include "shared-bindings/analogio/AnalogOut.h"
#include "shared-bindings/microcontroller/Pin.h"

#include "wasm_hal.h"

void common_hal_analogio_analogout_construct(analogio_analogout_obj_t *self,
    const mcu_pin_obj_t *pin) {
    if (!pin->has_dac) {
        raise_ValueError_invalid_pin();
    }
    self->pin = pin;
}

bool common_hal_analogio_analogout_deinited(analogio_analogout_obj_t *self) {
    return self->pin == NULL;
}

void common_hal_analogio_analogout_deinit(analogio_analogout_obj_t *self) {
    if (common_hal_analogio_analogout_deinited(self)) {
        return;
    }
    wasm_dac_write(self->pin->number, 0);
    self->pin = NULL;
}

void common_hal_analogio_analogout_set_value(analogio_analogout_obj_t *self,
    uint16_t value) {
    uint8_t dac_value = (value * 255) / 65535;
    wasm_dac_write(self->pin->number, dac_value);
}
