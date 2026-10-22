import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { parseArgs } from 'node:util';

import { createShared, views, CTRL, SCREEN_WIDTH, SCREEN_HEIGHT } from '../../web/src/emulator/shared.js';
import { createHal } from '../../web/src/emulator/hal.js';
import createCircuitPython from '../../web/public/firmware/circuitpython.mjs';

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        seconds: { type: 'string', default: '5' },
        png: { type: 'string' },
        touch: { type: 'string' },
        serial: { type: 'string' },
        lib: { type: 'string', multiple: true, default: [] },
    },
});

const files = [];
const addTree = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            addTree(full, `${prefix}/${name}`);
        } else if (name !== 'LICENSE') {
            files.push({ path: `${prefix}/${name}`, data: new Uint8Array(readFileSync(full)) });
        }
    }
};
if (statSync(positionals[0]).isDirectory()) {
    addTree(positionals[0], '');
} else {
    files.push({ path: '/code.py', data: new Uint8Array(readFileSync(positionals[0])) });
}
for (const lib of values.lib) {
    const name = basename(lib);
    const entries = readdirSync(lib).filter((n) => n.endsWith('.py'));
    if (entries.length === 1 && entries[0] === `${name}.py`) {
        files.push({ path: `/lib/${name}.py`, data: new Uint8Array(readFileSync(join(lib, entries[0]))) });
    } else {
        addTree(lib, `/lib/${name}`);
    }
}
const shared = views(createShared());
const decoder = new TextDecoder();
const deadline = performance.now() + Number(values.seconds) * 1000;

if (values.touch) {
    const [x, y] = values.touch.split(',').map(Number);
    Atomics.store(shared.ctrl, CTRL.TOUCH_X, x);
    Atomics.store(shared.ctrl, CTRL.TOUCH_Y, y);
    Atomics.store(shared.ctrl, CTRL.TOUCH_PRESSED, 1);
}
Atomics.store(shared.ctrl, CTRL.LIGHT_MV, 300);

const finish = () => {
    hal.flush();
    if (values.png) {
        writeFileSync(values.png, png(shared.framebuffer, SCREEN_WIDTH, SCREEN_HEIGHT));
    }
    const ctrl = shared.ctrl;
    console.error(
        `\n[display ${Atomics.load(ctrl, CTRL.DISPLAY_ON) ? 'on' : 'off'}, backlight ${Atomics.load(ctrl, CTRL.BACKLIGHT)}, ` +
        `led r${Atomics.load(ctrl, CTRL.LED_RED)} g${Atomics.load(ctrl, CTRL.LED_GREEN)} b${Atomics.load(ctrl, CTRL.LED_BLUE)}]`,
    );
    process.exit(0);
};

const hal = createHal(shared, files, (message) => {
    if (message.type === 'serial') {
        process.stdout.write(decoder.decode(message.bytes, { stream: true }));
    }
});

const background = hal.background;
let typed = false;
hal.background = () => {
    background();
    if (!typed && values.serial) {
        typed = true;
        const bytes = new TextEncoder().encode(values.serial.replace(/\\r/g, '\r').replace(/\\x03/g, '\x03'));
        let head = Atomics.load(shared.ctrl, CTRL.SERIAL_HEAD);
        for (const b of bytes) {
            shared.serial[head++] = b;
            if (b === 3) Atomics.store(shared.ctrl, CTRL.CTRL_C, 1);
        }
        Atomics.store(shared.ctrl, CTRL.SERIAL_HEAD, head);
    }
    if (performance.now() > deadline) {
        finish();
    }
};
const idle = hal.idle;
hal.idle = (ms) => {
    idle(ms);
    hal.background();
};

const module = await createCircuitPython({ hal });
module._main();

function png(rgba, width, height) {
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0;
        Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
    }
    const chunk = (type, data) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body));
        return Buffer.concat([length, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function crc32(buf) {
    let c = ~0;
    for (const b of buf) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
}
