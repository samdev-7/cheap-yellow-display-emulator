export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 240;

export const CTRL = {
    WAKE: 0,
    SERIAL_HEAD: 1,
    SERIAL_TAIL: 2,
    CTRL_C: 3,
    TOUCH_PRESSED: 4,
    TOUCH_X: 5,
    TOUCH_Y: 6,
    BOOT_BUTTON: 7,
    LIGHT_MV: 8,
    FRAME: 9,
    DRIVE_REQUEST: 10,
    DISPLAY_ON: 11,
    BACKLIGHT: 12,
    LED_RED: 13,
    LED_GREEN: 14,
    LED_BLUE: 15,
    OUTPUTS: 16,
    SD_INSERTED: 17,
    SD_GENERATION: 18,
    WIFI_MODE: 19,
    WIFI_DROP: 20,
    RESET_REASON: 21,
    WAKE_KIND: 22,
    WAKE_PIN: 23,
    WAKE_VALUE: 24,
    GENERATION: 25,
};

export const RESET_REASON = {
    POWER_ON: 0, // Also the RST button: on the ESP32, its EN pin is a power-on reset.
    SOFTWARE: 2,
    DEEP_SLEEP_ALARM: 3,
    WATCHDOG: 5,
};

const CTRL_BYTES = 32 * 4;
export const SERIAL_SIZE = 16384;
const FB_BYTES = SCREEN_WIDTH * SCREEN_HEIGHT * 4;
export const SD_AREA_SIZE = 64 * 1024;
export const NVM_SIZE = 8 * 1024;
export const SLEEP_MEMORY_SIZE = 3 * 1024;

export function createShared() {
    return new SharedArrayBuffer(CTRL_BYTES + SERIAL_SIZE + FB_BYTES + SD_AREA_SIZE + NVM_SIZE + SLEEP_MEMORY_SIZE);
}

export function views(sab) {
    let offset = 0;
    const ctrl = new Int32Array(sab, offset, CTRL_BYTES / 4);
    offset += CTRL_BYTES;
    const serial = new Uint8Array(sab, offset, SERIAL_SIZE);
    offset += SERIAL_SIZE;
    const framebuffer = new Uint8Array(sab, offset, FB_BYTES);
    offset += FB_BYTES;
    const sdArea = new Uint8Array(sab, offset, SD_AREA_SIZE);
    offset += SD_AREA_SIZE;
    const nvm = new Uint8Array(sab, offset, NVM_SIZE);
    offset += NVM_SIZE;
    const sleepMemory = new Uint8Array(sab, offset, SLEEP_MEMORY_SIZE);
    return { ctrl, serial, framebuffer, sdArea, nvm, sleepMemory };
}

export function packCard(card, area) {
    const view = new DataView(area.buffer, area.byteOffset, area.byteLength);
    const entries = [...card.blocks.entries()];
    if (8 + entries.length * 516 > area.length) {
        throw new Error('Card image is too large to hand over while running.');
    }
    view.setUint32(0, card.sectors, true);
    view.setUint32(4, entries.length, true);
    let offset = 8;
    for (const [index, data] of entries) {
        view.setUint32(offset, index, true);
        area.set(data, offset + 4);
        offset += 516;
    }
}

export function unpackCard(area) {
    const view = new DataView(area.buffer, area.byteOffset, area.byteLength);
    const sectors = view.getUint32(0, true);
    const count = view.getUint32(4, true);
    const blocks = new Map();
    let offset = 8;
    for (let i = 0; i < count; i++) {
        blocks.set(view.getUint32(offset, true), area.slice(offset + 4, offset + 516));
        offset += 516;
    }
    return { sectors, blocks };
}
