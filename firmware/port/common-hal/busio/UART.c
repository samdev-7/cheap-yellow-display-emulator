// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#include <errno.h>

#include "shared-bindings/busio/UART.h"
#include "shared-bindings/microcontroller/Pin.h"

#include "py/mperrno.h"
#include "py/runtime.h"
#include "py/stream.h"
#include "supervisor/shared/tick.h"

#include "wasm_hal.h"

#define UART_NUM_MAX 3
#define CONSOLE_TX 1
#define CONSOLE_RX 3

static bool _uart_in_use[UART_NUM_MAX];

void common_hal_busio_uart_construct(busio_uart_obj_t *self,
    const mcu_pin_obj_t *tx, const mcu_pin_obj_t *rx,
    const mcu_pin_obj_t *rts, const mcu_pin_obj_t *cts,
    const mcu_pin_obj_t *rs485_dir, bool rs485_invert,
    uint32_t baudrate, uint8_t bits, busio_uart_parity_t parity, uint8_t stop,
    mp_float_t timeout, uint16_t receiver_buffer_size, byte *receiver_buffer,
    bool sigint_enabled) {

    if (bits > 8) {
        mp_raise_NotImplementedError(MP_ERROR_TEXT("bytes > 8 bits not supported"));
    }

    if ((tx != NULL && tx->input_only) || (rts != NULL && rts->input_only) ||
        (rs485_dir != NULL && rs485_dir->input_only)) {
        raise_ValueError_invalid_pins();
    }

    self->uart_num = -1;
    for (int8_t num = 0; num < UART_NUM_MAX; num++) {
        if (!_uart_in_use[num]) {
            self->uart_num = num;
            break;
        }
    }
    if (self->uart_num < 0) {
        mp_raise_ValueError(MP_ERROR_TEXT("All UART peripherals are in use"));
    }
    _uart_in_use[self->uart_num] = true;

    self->is_console = tx != NULL && rx != NULL &&
        tx->number == CONSOLE_TX && rx->number == CONSOLE_RX;
    self->tx_pin = tx;
    self->rx_pin = rx;
    self->rts_pin = rts;
    self->cts_pin = cts;
    self->character_bits = bits;
    self->baudrate = baudrate;
    self->timeout_ms = timeout * 1000;

    if (tx != NULL) {
        claim_pin(tx);
    }
    if (rx != NULL) {
        claim_pin(rx);
    }
    if (rts != NULL) {
        claim_pin(rts);
    }
    if (cts != NULL) {
        claim_pin(cts);
    }
}

bool common_hal_busio_uart_deinited(busio_uart_obj_t *self) {
    return self->rx_pin == NULL && self->tx_pin == NULL;
}

void common_hal_busio_uart_deinit(busio_uart_obj_t *self) {
    if (common_hal_busio_uart_deinited(self)) {
        return;
    }
    _uart_in_use[self->uart_num] = false;
    common_hal_reset_pin(self->rx_pin);
    common_hal_reset_pin(self->tx_pin);
    common_hal_reset_pin(self->rts_pin);
    common_hal_reset_pin(self->cts_pin);
    self->rx_pin = NULL;
    self->tx_pin = NULL;
    self->cts_pin = NULL;
    self->rts_pin = NULL;
}

void common_hal_busio_uart_never_reset(busio_uart_obj_t *self) {
    common_hal_never_reset_pin(self->rx_pin);
    common_hal_never_reset_pin(self->tx_pin);
    common_hal_never_reset_pin(self->rts_pin);
    common_hal_never_reset_pin(self->cts_pin);
}

static size_t _available(busio_uart_obj_t *self) {
    return self->is_console ? wasm_serial_available() : 0;
}

size_t common_hal_busio_uart_read(busio_uart_obj_t *self, uint8_t *data, size_t len, int *errcode) {
    if (self->rx_pin == NULL) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("No %q pin"), MP_QSTR_rx);
    }
    if (len == 0) {
        // Nothing to read.
        return 0;
    }

    size_t total_read = 0;
    uint64_t start_ticks = supervisor_ticks_ms64();

    while (supervisor_ticks_ms64() - start_ticks <= self->timeout_ms) {
        size_t num_read = 0;
        while (len > 0 && _available(self) > 0) {
            *data++ = wasm_serial_read();
            len--;
            num_read++;
        }
        total_read += num_read;
        if (len == 0) {
            break;
        }
        if (num_read > 0) {
            // Reset the timeout on every character read.
            start_ticks = supervisor_ticks_ms64();
        }
        RUN_BACKGROUND_TASKS;
        // Allow user to break out of a timeout with a KeyboardInterrupt.
        if (mp_hal_is_interrupted()) {
            break;
        }
        // If we are zero timeout, make sure we don't loop again (in the event
        // we read in under 1ms)
        if (self->timeout_ms == 0) {
            break;
        }
    }

    if (total_read == 0) {
        *errcode = EAGAIN;
        return MP_STREAM_ERROR;
    }

    return total_read;
}

size_t common_hal_busio_uart_write(busio_uart_obj_t *self, const uint8_t *data, size_t len, int *errcode) {
    if (self->tx_pin == NULL) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("No %q pin"), MP_QSTR_tx);
    }
    if (self->is_console) {
        wasm_serial_write((const char *)data, len);
    }
    return len;
}

uint32_t common_hal_busio_uart_get_baudrate(busio_uart_obj_t *self) {
    return self->baudrate;
}

void common_hal_busio_uart_set_baudrate(busio_uart_obj_t *self, uint32_t baudrate) {
    self->baudrate = baudrate;
}

mp_float_t common_hal_busio_uart_get_timeout(busio_uart_obj_t *self) {
    return (mp_float_t)(self->timeout_ms / 1000.0f);
}

void common_hal_busio_uart_set_timeout(busio_uart_obj_t *self, mp_float_t timeout) {
    self->timeout_ms = timeout * 1000;
}

uint32_t common_hal_busio_uart_rx_characters_available(busio_uart_obj_t *self) {
    return _available(self);
}

void common_hal_busio_uart_clear_rx_buffer(busio_uart_obj_t *self) {
    while (_available(self) > 0) {
        wasm_serial_read();
    }
}

bool common_hal_busio_uart_ready_to_tx(busio_uart_obj_t *self) {
    return true;
}
