// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <math.h>
#include <string.h>

#include "py/runtime.h"
#include "shared-bindings/microcontroller/Processor.h"

#include "wasm_hal.h"
#include "shared-bindings/microcontroller/ResetReason.h"

// CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ
static uint32_t _frequency_mhz = 240;

float common_hal_mcu_processor_get_temperature(void) {
    return NAN;
}

float common_hal_mcu_processor_get_voltage(void) {
    return NAN;
}

uint32_t common_hal_mcu_processor_get_frequency(void) {
    return _frequency_mhz * 1000000;
}

static uint32_t get_valid_cpu_frequency(uint32_t requested_freq_mhz) {
    uint32_t valid_cpu_frequencies[] = {20, 40, 80, 160, 240};

    if (requested_freq_mhz < valid_cpu_frequencies[0]) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("Invalid %q"), MP_QSTR_frequency);
    }

    const size_t num_valid_frequencies = MP_ARRAY_SIZE(valid_cpu_frequencies);

    for (size_t i = 1; i < num_valid_frequencies; i++) {
        if (requested_freq_mhz < valid_cpu_frequencies[i]) {
            return valid_cpu_frequencies[i - 1];
        }
    }

    return valid_cpu_frequencies[num_valid_frequencies - 1];
}

void common_hal_mcu_processor_set_frequency(mcu_processor_obj_t *self, uint32_t frequency) {
    _frequency_mhz = get_valid_cpu_frequency(frequency / 1000000);
}

void common_hal_mcu_processor_get_uid(uint8_t raw_id[]) {
    static const uint8_t uid[COMMON_HAL_MCU_PROCESSOR_UID_LENGTH] = {0x02, 0x43, 0x59, 0x44, 0x00, 0x01};
    memcpy(raw_id, uid, sizeof(uid));
}

mcu_reset_reason_t common_hal_mcu_processor_get_reset_reason(void) {
    return (mcu_reset_reason_t)wasm_hal_reset_reason();
}
