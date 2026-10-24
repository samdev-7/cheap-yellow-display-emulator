import { CTRL, SERIAL_SIZE, unpackCard } from './shared.js';
import { CYDBoard } from './board.js';
import { Network } from './network.js';
import { Speed } from './speed.js';

const OUTPUT_FLUSH_MS = 16;
const OUTPUT_FLUSH_BYTES = 4096;
const SD_SYNC_MS = 500;

export function createHal(shared, files, post, card, { realSpeed = true, costScale = 1 } = {}) {
    const { ctrl, serial, sdArea, nvm, sleepMemory } = shared;
    const board = new CYDBoard(shared, card);
    board.reset();

    let sdGeneration = Atomics.load(ctrl, CTRL.SD_GENERATION);
    let lastSdSync = 0;
    const syncCard = () => {
        const generation = Atomics.load(ctrl, CTRL.SD_GENERATION);
        if (generation !== sdGeneration) {
            sdGeneration = generation;
            board.sd.load(unpackCard(sdArea));
            board.sdWasInserted = false;
        }
        if (board.sd.dirty.size > 0) {
            const blocks = [...board.sd.dirty].map((index) => [index, board.sd.blocks.get(index).slice()]);
            board.sd.dirty.clear();
            post({ type: 'sd-blocks', generation: sdGeneration, blocks });
        }
        lastSdSync = performance.now();
    };

    let nvmDirty = false;
    const syncNvm = () => {
        if (nvmDirty) {
            nvmDirty = false;
            post({ type: 'nvm' });
        }
    };

    const halt = () => {
        for (;;) {
            Atomics.wait(ctrl, CTRL.WAKE, Atomics.load(ctrl, CTRL.WAKE));
        }
    };

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

    const pause = (ms) => {
        flush();
        if (performance.now() - lastSdSync > SD_SYNC_MS) {
            syncCard();
            syncNvm();
        }
        Atomics.wait(ctrl, CTRL.WAKE, Atomics.load(ctrl, CTRL.WAKE), ms);
    };
    const sleep = (ms) => {
        const start = performance.now();
        pause(ms);
        speed.idled(performance.now() - start);
    };
    const speed = new Speed({
        enabled: realSpeed,
        costScale,
        sleep: (ms) => {
            const until = performance.now() + ms;
            for (let left = ms; left > 0; left = until - performance.now()) {
                pause(left);
            }
        },
        report: (ratio) => post({ type: 'speed', ratio }),
    });

    const pendingFiles = [...files];

    const hal = {
        nowUs: () => (performance.now() - start) * 1000,
        idle: (ms) => sleep(ms),
        background: () => {
            speed.tick();
            if (++backgroundCalls & 0xf) {
                return;
            }
            const now = performance.now();
            if (outputBytes > OUTPUT_FLUSH_BYTES || now - lastFlush > OUTPUT_FLUSH_MS) {
                flush();
            }
            if (now - lastSdSync > SD_SYNC_MS) {
                syncCard();
                syncNvm();
            }
        },
        reset: (toBootloader) => {
            flush();
            post({ type: 'reset', toBootloader });
            halt();
        },
        restart: (reason) => {
            hal.flush();
            post({ type: 'restart', reason });
            halt();
        },
        resetReason: () => Atomics.load(ctrl, CTRL.RESET_REASON),
        wakeAlarm: () => ({
            kind: Atomics.load(ctrl, CTRL.WAKE_KIND),
            pin: Atomics.load(ctrl, CTRL.WAKE_PIN),
            value: Atomics.load(ctrl, CTRL.WAKE_VALUE),
        }),
        deepSleep: (timeMs, pins, values) => {
            hal.flush();
            post({ type: 'deep-sleep', timeMs, pins, values });
            halt();
        },
        nvmRead: (offset, into) => into.set(nvm.subarray(offset, offset + into.length)),
        nvmWrite: (offset, data) => {
            nvm.set(data, offset);
            nvmDirty = true;
        },
        sleepMemoryRead: (offset, into) => into.set(sleepMemory.subarray(offset, offset + into.length)),
        sleepMemoryWrite: (offset, data) => sleepMemory.set(data, offset),

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

        fsNextOp: () => pendingFiles.shift() ?? null,
        fsOpsDone: (errors) => post({ type: 'files-applied', errors }),

        net: new Network(ctrl, post),
        vmCounters: (readOpcodes, readCalls) => speed.counters(readOpcodes, readCalls),
        speed,
    };

    hal.flush = () => {
        flush();
        syncCard();
        syncNvm();
    };
    return hal;
}
