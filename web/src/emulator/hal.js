import { CTRL, SERIAL_SIZE, unpackOps } from './shared.js';
import { CYDBoard } from './board.js';

const OUTPUT_FLUSH_MS = 16;
const OUTPUT_FLUSH_BYTES = 4096;

export function createHal(shared, files, post) {
    const { ctrl, serial, mailbox } = shared;
    const board = new CYDBoard(shared);
    board.reset();

    const start = performance.now();
    let output = [];
    let outputBytes = 0;
    let lastFlush = 0;
    let backgroundCalls = 0;
    let emptyPolls = 0;
    let emptyPollStart = 0;

    const flush = () => {
        if (outputBytes > 0) {
            const bytes = new Uint8Array(outputBytes);
            let offset = 0;
            for (const chunk of output) {
                bytes.set(chunk, offset);
                offset += chunk.length;
            }
            post({ type: 'serial', bytes }, [bytes.buffer]);
            output = [];
            outputBytes = 0;
        }
        lastFlush = performance.now();
    };

    const sleep = (ms) => {
        flush();
        Atomics.wait(ctrl, CTRL.WAKE, Atomics.load(ctrl, CTRL.WAKE), ms);
    };

    let pendingOps = files.map((f) => ({ kind: 1, path: f.path, data: f.data }));
    let fromMailbox = false;

    const hal = {
        nowUs: () => (performance.now() - start) * 1000,
        idle: (ms) => sleep(ms),
        background: () => {
            if (++backgroundCalls & 0xff) {
                return;
            }
            if (outputBytes > OUTPUT_FLUSH_BYTES || performance.now() - lastFlush > OUTPUT_FLUSH_MS) {
                flush();
            }
        },
        reset: (toBootloader) => {
            flush();
            post({ type: 'reset', toBootloader });
            for (;;) {
                Atomics.wait(ctrl, CTRL.WAKE, Atomics.load(ctrl, CTRL.WAKE));
            }
        },

        serialWrite: (bytes) => {
            output.push(bytes);
            outputBytes += bytes.length;
            if (outputBytes > OUTPUT_FLUSH_BYTES) {
                flush();
            }
        },
        serialAvailable: () => {
            const head = Atomics.load(ctrl, CTRL.SERIAL_HEAD);
            const tail = Atomics.load(ctrl, CTRL.SERIAL_TAIL);
            const available = (head - tail + SERIAL_SIZE) % SERIAL_SIZE;
            if (available > 0) {
                emptyPolls = 0;
                return available;
            }
            const now = performance.now();
            if (emptyPolls === 0) {
                emptyPollStart = now;
            }
            if (++emptyPolls > 1000 && now - emptyPollStart < 5) {
                sleep(2);
                emptyPolls = 0;
            } else if (now - emptyPollStart >= 5) {
                emptyPolls = 0;
            }
            return 0;
        },
        serialRead: () => {
            const head = Atomics.load(ctrl, CTRL.SERIAL_HEAD);
            const tail = Atomics.load(ctrl, CTRL.SERIAL_TAIL);
            if (head === tail) {
                return -1;
            }
            const c = serial[tail];
            Atomics.store(ctrl, CTRL.SERIAL_TAIL, (tail + 1) % SERIAL_SIZE);
            return c;
        },
        serialCheckInterrupt: () => {
            if (Atomics.load(ctrl, CTRL.CTRL_C) === 0) {
                return false;
            }
            Atomics.store(ctrl, CTRL.CTRL_C, 0);
            Atomics.store(ctrl, CTRL.SERIAL_TAIL, Atomics.load(ctrl, CTRL.SERIAL_HEAD));
            return true;
        },

        gpioConfig: (pin, mode, pull) => board.gpioConfig(pin, mode, pull),
        gpioSet: (pin, value) => board.gpioSet(pin, value),
        gpioGet: (pin) => board.gpioGet(pin),
        spiConfig: () => {},
        spiTransfer: (sck, out, into, len, writeValue) => board.spiTransfer(sck, out, into, len, writeValue),
        i2cWrite: (scl, addr, data) => board.i2cWrite(scl, addr, data),
        i2cRead: (scl, addr, into) => board.i2cRead(scl, addr, into),
        pwmSet: (pin, duty, frequency) => board.pwmSet(pin, duty, frequency),
        adcRead: (pin) => board.adcRead(pin),
        dacWrite: (pin, value) => board.dacWrite(pin, value),

        fsNextOp: () => {
            if (pendingOps.length === 0 && !fromMailbox && Atomics.load(ctrl, CTRL.MAILBOX_STATE) === 1) {
                pendingOps = unpackOps(mailbox);
                fromMailbox = true;
            }
            return pendingOps.shift() ?? null;
        },
        fsOpsDone: (errors) => {
            const saved = fromMailbox;
            if (fromMailbox) {
                fromMailbox = false;
                Atomics.store(ctrl, CTRL.MAILBOX_STATE, 0);
            }
            post({ type: 'files-applied', errors, saved });
        },
        flashLoad: () => {},
        flashDirty: () => {},
    };

    hal.flush = flush;
    return hal;
}
