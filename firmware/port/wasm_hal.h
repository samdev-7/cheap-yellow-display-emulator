// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

double wasm_hal_now_us(void);
void wasm_hal_idle(uint32_t timeout_ms);
void wasm_hal_background(void);

void wasm_serial_write(const char *text, uint32_t len);
uint32_t wasm_serial_available(void);
int wasm_serial_read(void);
int wasm_serial_check_interrupt(void);

void wasm_gpio_config(uint8_t pin, uint8_t mode, uint8_t pull);
void wasm_gpio_set(uint8_t pin, bool value);
bool wasm_gpio_get(uint8_t pin);

void wasm_spi_config(uint8_t sck, uint8_t mosi, uint8_t miso, uint32_t baudrate, uint8_t polarity, uint8_t phase);
void wasm_spi_transfer(uint8_t sck, const uint8_t *data_out, uint8_t *data_in, uint32_t len, uint8_t write_value);

int wasm_i2c_write(uint8_t scl, uint8_t addr, const uint8_t *data, uint32_t len);
int wasm_i2c_read(uint8_t scl, uint8_t addr, uint8_t *data, uint32_t len);

void wasm_pwm_set(uint8_t pin, uint16_t duty, uint32_t frequency);

int wasm_adc_read(uint8_t pin);
void wasm_dac_write(uint8_t pin, uint8_t value);

void wasm_random_fill(uint8_t *buffer, uint32_t len);

int wasm_fs_next_op(char *path_buf, uint32_t path_cap, uint32_t *data_len);
void wasm_fs_op_data(uint8_t *dest);
void wasm_fs_ops_done(int errors);

void wasm_flash_load(uint8_t *flash, uint32_t len);
void wasm_flash_dirty(uint32_t offset, uint32_t len);

void wasm_hal_reset(int to_bootloader);
