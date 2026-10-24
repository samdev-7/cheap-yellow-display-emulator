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
void wasm_hal_vm_counters(const uint32_t *opcodes, const uint32_t *calls);

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

void wasm_wifi_set_home(const char *ssid, uint32_t len);
int wasm_wifi_connect(const char *ssid, uint32_t len);
void wasm_wifi_disconnect(void);
#define WASM_WIFI_DELAY_JOIN 0
#define WASM_WIFI_DELAY_SCAN 1
#define WASM_WIFI_DELAY_PING 2
uint32_t wasm_wifi_delay_ms(int kind);
bool wasm_wifi_connected(void);
int wasm_wifi_scan(uint32_t index, char *ssid, int32_t *info);
void wasm_wifi_ap_info(char *ssid, int32_t *info);

#define WASM_NET_DNS_NOT_FOUND 1000
int wasm_net_lookup(const char *host, uint32_t len, uint32_t *ip);
int wasm_net_socket(bool udp);
int wasm_net_set_tls(int id, const char *hostname, uint32_t len);
int wasm_net_connect(int id, uint32_t ip, uint32_t port);
int wasm_net_send(int id, const uint8_t *buf, uint32_t len);
int wasm_net_recv(int id, uint8_t *buf, uint32_t len);
int wasm_net_sendto(int id, uint32_t ip, uint32_t port, const uint8_t *buf, uint32_t len);
int wasm_net_recvfrom(int id, uint8_t *buf, uint32_t len, uint32_t *ip, uint32_t *port);
bool wasm_net_readable(int id);
void wasm_net_close(int id);
void wasm_net_reset(void);

void wasm_nvm_read(uint32_t offset, uint8_t *buf, uint32_t len);
void wasm_nvm_write(uint32_t offset, const uint8_t *buf, uint32_t len);
void wasm_sleep_memory_read(uint32_t offset, uint8_t *buf, uint32_t len);
void wasm_sleep_memory_write(uint32_t offset, const uint8_t *buf, uint32_t len);

int wasm_hal_reset_reason(void);
void wasm_hal_restart(int reason);

int wasm_alarm_wake(uint32_t *pin, uint32_t *value);
void wasm_alarm_deep_sleep(int32_t time_ms, const uint8_t *pins, const uint8_t *values, uint32_t count);

void wasm_hal_reset(int to_bootloader);
