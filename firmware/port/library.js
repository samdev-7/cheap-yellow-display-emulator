// This file is part of the CircuitPython project: https://circuitpython.org
//
// SPDX-License-Identifier: MIT

addToLibrary({
    wasm_hal_now_us: () => Module.hal.nowUs(),
    wasm_hal_idle: (timeoutMs) => Module.hal.idle(timeoutMs),
    wasm_hal_background: () => Module.hal.background(),
    wasm_hal_vm_counters: (opcodes, calls) => Module.hal.vmCounters(() => HEAPU32[opcodes >> 2], () => HEAPU32[calls >> 2]),
    wasm_hal_reset: (toBootloader) => Module.hal.reset(toBootloader !== 0),

    wasm_serial_write: (ptr, len) => Module.hal.serialWrite(HEAPU8.slice(ptr, ptr + len)),
    wasm_serial_available: () => Module.hal.serialAvailable(),
    wasm_serial_read: () => Module.hal.serialRead(),
    wasm_serial_check_interrupt: () => (Module.hal.serialCheckInterrupt() ? 1 : 0),

    wasm_gpio_config: (pin, mode, pull) => Module.hal.gpioConfig(pin, mode, pull),
    wasm_gpio_set: (pin, value) => Module.hal.gpioSet(pin, value !== 0),
    wasm_gpio_get: (pin) => (Module.hal.gpioGet(pin) ? 1 : 0),

    wasm_spi_config: (sck, mosi, miso, baudrate, polarity, phase) =>
        Module.hal.spiConfig(sck, mosi, miso, baudrate >>> 0, polarity, phase),
    wasm_spi_transfer: (sck, outPtr, inPtr, len, writeValue) =>
        Module.hal.spiTransfer(
            sck,
            outPtr ? HEAPU8.subarray(outPtr, outPtr + len) : null,
            inPtr ? HEAPU8.subarray(inPtr, inPtr + len) : null,
            len,
            writeValue,
        ),

    wasm_i2c_write: (scl, addr, ptr, len) =>
        Module.hal.i2cWrite(scl, addr, ptr ? HEAPU8.subarray(ptr, ptr + len) : new Uint8Array(0)),
    wasm_i2c_read: (scl, addr, ptr, len) =>
        Module.hal.i2cRead(scl, addr, HEAPU8.subarray(ptr, ptr + len)),

    wasm_pwm_set: (pin, duty, frequency) => Module.hal.pwmSet(pin, duty, frequency >>> 0),
    wasm_adc_read: (pin) => Module.hal.adcRead(pin),
    wasm_dac_write: (pin, value) => Module.hal.dacWrite(pin, value),

    wasm_random_fill: (ptr, len) => {
        // getRandomValues refuses views over shared memory and caps at 64KB.
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i += 65536) {
            crypto.getRandomValues(bytes.subarray(i, Math.min(len, i + 65536)));
        }
        HEAPU8.set(bytes, ptr);
    },

    wasm_fs_next_op__deps: ['$stringToUTF8'],
    wasm_fs_next_op: (pathPtr, pathCap, lenPtr) => {
        const op = Module.hal.fsNextOp();
        if (!op) {
            return 0;
        }
        stringToUTF8(op.path, pathPtr, pathCap);
        HEAPU32[lenPtr >> 2] = op.data ? op.data.length : 0;
        Module.hal.fsCurrent = op;
        return op.kind;
    },
    wasm_fs_op_data: (dest) => {
        HEAPU8.set(Module.hal.fsCurrent.data, dest);
    },
    wasm_fs_ops_done: (errors) => Module.hal.fsOpsDone(errors),

    wasm_wifi_set_home__deps: ['$UTF8ToString'],
    wasm_wifi_set_home: (ptr, len) => Module.hal.net.setHome(UTF8ToString(ptr, len)),
    wasm_wifi_connect__deps: ['$UTF8ToString'],
    wasm_wifi_connect: (ptr, len) => Module.hal.net.join(UTF8ToString(ptr, len)),
    wasm_wifi_disconnect: () => Module.hal.net.leave(),
    wasm_wifi_delay_ms: (kind) => Module.hal.net.delay(kind),
    wasm_wifi_connected: () => (Module.hal.net.isConnected() ? 1 : 0),
    wasm_wifi_scan__deps: ['$writeNetwork'],
    wasm_wifi_scan: (index, ssidPtr, infoPtr) => {
        const network = Module.hal.net.scan()[index];
        if (!network) {
            return 0;
        }
        writeNetwork(network, ssidPtr, infoPtr);
        return 1;
    },
    wasm_wifi_ap_info__deps: ['$writeNetwork'],
    wasm_wifi_ap_info: (ssidPtr, infoPtr) => writeNetwork(Module.hal.net.accessPoint(), ssidPtr, infoPtr),
    $writeNetwork__deps: ['$stringToUTF8'],
    $writeNetwork: (network, ssidPtr, infoPtr) => {
        stringToUTF8(network.ssid, ssidPtr, 33);
        HEAP32[infoPtr >> 2] = network.rssi;
        HEAP32[(infoPtr >> 2) + 1] = network.channel;
        HEAP32[(infoPtr >> 2) + 2] = network.authmode === 'open' ? 0 : 1;
    },

    wasm_net_lookup__deps: ['$UTF8ToString'],
    wasm_net_lookup: (hostPtr, len, ipPtr) => {
        const { result, ip } = Module.hal.net.lookup(UTF8ToString(hostPtr, len));
        if (result === 0) {
            HEAPU32[ipPtr >> 2] = ip;
        }
        return result;
    },
    wasm_net_socket: (udp) => Module.hal.net.socket(udp !== 0),
    wasm_net_set_tls__deps: ['$UTF8ToString'],
    wasm_net_set_tls: (id, ptr, len) => Module.hal.net.setTls(id, len ? UTF8ToString(ptr, len) : ''),
    wasm_net_connect: (id, ip, port) => Module.hal.net.connect(id, ip >>> 0, port),
    wasm_net_send: (id, ptr, len) => Module.hal.net.send(id, HEAPU8.slice(ptr, ptr + len)),
    wasm_net_recv: (id, ptr, len) => {
        const { result, bytes } = Module.hal.net.recv(id, len);
        if (result > 0) {
            HEAPU8.set(bytes, ptr);
        }
        return result;
    },
    wasm_net_sendto: (id, ip, port, ptr, len) => Module.hal.net.sendto(id, ip >>> 0, port, HEAPU8.slice(ptr, ptr + len)),
    wasm_net_recvfrom: (id, ptr, len, ipPtr, portPtr) => {
        const { result, bytes, from, port } = Module.hal.net.recv(id, len);
        if (result > 0) {
            HEAPU8.set(bytes, ptr);
            HEAPU32[ipPtr >> 2] = from;
            HEAPU32[portPtr >> 2] = port;
        }
        return result;
    },
    wasm_net_readable: (id) => (Module.hal.net.readable(id) ? 1 : 0),
    wasm_net_close: (id) => Module.hal.net.close(id),
    wasm_net_reset: () => Module.hal.net.reset(),

    wasm_flash_load: (ptr, len) => Module.hal.flashLoad(HEAPU8.subarray(ptr, ptr + len)),
    wasm_flash_dirty: (offset, len) => Module.hal.flashDirty(offset, len),
});
