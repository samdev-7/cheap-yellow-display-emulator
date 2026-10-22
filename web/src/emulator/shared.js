export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 240;

export const CTRL = {
    WAKE: 0, // Bumped by the page whenever there is new input.
    SERIAL_HEAD: 1, // Next write position in the serial input ring (page).
    SERIAL_TAIL: 2, // Next read position in the serial input ring (worker).
    CTRL_C: 3, // Set when Ctrl-C has been typed and not yet handled.
    TOUCH_PRESSED: 4,
    TOUCH_X: 5, // Screen pixels, 0..319.
    TOUCH_Y: 6, // Screen pixels, 0..239.
    BOOT_BUTTON: 7, // 1 while the BOOT button is held down.
    LIGHT_MV: 8, // Voltage on the light sensor pin, in millivolts.
    FRAME: 9, // Bumped by the worker whenever the screen changes.
    MAILBOX_STATE: 10, // 1 when the mailbox holds file operations to apply.
    DISPLAY_ON: 11, // 1 when the panel is out of sleep and switched on.
    BACKLIGHT: 12, // 0..1000.
    LED_RED: 13, // 0..1000.
    LED_GREEN: 14, // 0..1000.
    LED_BLUE: 15, // 0..1000.
    OUTPUTS: 16, // Bumped by the worker whenever an LED or the backlight changes.
};

const CTRL_BYTES = 32 * 4;
export const SERIAL_SIZE = 16384;
const FB_BYTES = SCREEN_WIDTH * SCREEN_HEIGHT * 4;
export const MAILBOX_SIZE = 4 * 1024 * 1024;

export function createShared() {
    return new SharedArrayBuffer(CTRL_BYTES + SERIAL_SIZE + FB_BYTES + MAILBOX_SIZE);
}

export function views(sab) {
    let offset = 0;
    const ctrl = new Int32Array(sab, offset, CTRL_BYTES / 4);
    offset += CTRL_BYTES;
    const serial = new Uint8Array(sab, offset, SERIAL_SIZE);
    offset += SERIAL_SIZE;
    const framebuffer = new Uint8Array(sab, offset, FB_BYTES);
    offset += FB_BYTES;
    const mailbox = new Uint8Array(sab, offset, MAILBOX_SIZE);
    return { ctrl, serial, framebuffer, mailbox };
}

export function packOps(ops, mailbox) {
    const header = new TextEncoder().encode(
        JSON.stringify(ops.map((op) => ({ kind: op.kind, path: op.path, size: op.data ? op.data.length : 0 }))),
    );
    let size = 4 + header.length;
    for (const op of ops) {
        size += op.data ? op.data.length : 0;
    }
    if (size > mailbox.length) {
        throw new Error('Files are too large to send to the emulator at once.');
    }
    new DataView(mailbox.buffer, mailbox.byteOffset).setUint32(0, header.length, true);
    mailbox.set(header, 4);
    let offset = 4 + header.length;
    for (const op of ops) {
        if (op.data) {
            mailbox.set(op.data, offset);
            offset += op.data.length;
        }
    }
}

export function unpackOps(mailbox) {
    const headerLength = new DataView(mailbox.buffer, mailbox.byteOffset).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(mailbox.slice(4, 4 + headerLength)));
    let offset = 4 + headerLength;
    return header.map((op) => {
        const data = op.kind === 1 ? mailbox.slice(offset, offset + op.size) : null;
        offset += op.size;
        return { kind: op.kind, path: op.path, data };
    });
}
