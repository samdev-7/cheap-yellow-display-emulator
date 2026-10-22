import { CTRL, SERIAL_SIZE, createShared, packOps, views } from './shared.js';

export class Emulator extends EventTarget {
    constructor({ firmwareUrl }) {
        super();
        this.firmwareUrl = new URL(firmwareUrl, location.href).href;
        this.sab = createShared();
        this.shared = views(this.sab);
        this.worker = null;
        this.queuedOps = [];
        this.mailboxBusy = false;
        Atomics.store(this.shared.ctrl, CTRL.LIGHT_MV, 300);
    }

    get ctrl() {
        return this.shared.ctrl;
    }

    get framebuffer() {
        return this.shared.framebuffer;
    }

    start(files) {
        this.stop();
        const ctrl = this.ctrl;
        for (const slot of [CTRL.SERIAL_HEAD, CTRL.SERIAL_TAIL, CTRL.CTRL_C, CTRL.MAILBOX_STATE]) {
            Atomics.store(ctrl, slot, 0);
        }
        this.queuedOps = [];
        this.mailboxBusy = false;
        this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event) => this.onWorkerMessage(event.data);
        this.worker.onerror = (event) => {
            this.emit('state', { running: false, message: `Emulator failed to start: ${event.message}` });
        };
        this.worker.postMessage({ type: 'start', sab: this.sab, firmwareUrl: this.firmwareUrl, files });
        this.emit('state', { running: true, message: 'Starting…' });
    }

    stop() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }

    reset(files) {
        this.start(files);
    }

    onWorkerMessage(message) {
        switch (message.type) {
            case 'serial':
                this.emit('serial', message.bytes);
                break;
            case 'started':
                this.emit('state', { running: true, message: 'Running' });
                break;
            case 'files-applied':
                if (message.saved) {
                    this.mailboxBusy = false;
                }
                this.emit('files-applied', { errors: message.errors, saved: message.saved });
                this.flushOps();
                break;
            case 'reset':
                this.emit('reset-requested', { toBootloader: message.toBootloader });
                break;
            case 'crashed':
                this.emit('state', { running: false, message: `CircuitPython stopped: ${message.message}` });
                break;
            default:
                break;
        }
    }

    applyFiles(ops) {
        const kinds = { write: 1, mkdir: 2, delete: 3 };
        for (const op of ops) {
            this.queuedOps.push({ kind: kinds[op.kind], path: op.path, data: op.data ?? null });
        }
        this.flushOps();
    }

    flushOps() {
        if (this.mailboxBusy || this.queuedOps.length === 0 || !this.worker) {
            return;
        }
        packOps(this.queuedOps, this.shared.mailbox);
        this.queuedOps = [];
        this.mailboxBusy = true;
        Atomics.store(this.ctrl, CTRL.MAILBOX_STATE, 1);
        this.wake();
    }

    sendSerial(bytes) {
        const ctrl = this.ctrl;
        let head = Atomics.load(ctrl, CTRL.SERIAL_HEAD);
        for (const b of bytes) {
            const next = (head + 1) % SERIAL_SIZE;
            if (next === Atomics.load(ctrl, CTRL.SERIAL_TAIL)) {
                break; // Input buffer full; drop the rest, as a UART FIFO would.
            }
            this.shared.serial[head] = b;
            head = next;
            if (b === 0x03) {
                Atomics.store(ctrl, CTRL.CTRL_C, 1);
            }
        }
        Atomics.store(ctrl, CTRL.SERIAL_HEAD, head);
        this.wake();
    }

    interrupt() {
        this.sendSerial(new Uint8Array([0x03]));
    }

    setTouch(pressed, x = 0, y = 0) {
        const ctrl = this.ctrl;
        Atomics.store(ctrl, CTRL.TOUCH_X, Math.round(x));
        Atomics.store(ctrl, CTRL.TOUCH_Y, Math.round(y));
        Atomics.store(ctrl, CTRL.TOUCH_PRESSED, pressed ? 1 : 0);
        this.wake();
    }

    setBootButton(pressed) {
        Atomics.store(this.ctrl, CTRL.BOOT_BUTTON, pressed ? 1 : 0);
        this.wake();
    }

    setLightSensorMillivolts(mv) {
        Atomics.store(this.ctrl, CTRL.LIGHT_MV, Math.round(mv));
    }

    outputs() {
        const ctrl = this.ctrl;
        return {
            displayOn: Atomics.load(ctrl, CTRL.DISPLAY_ON) === 1,
            backlight: Atomics.load(ctrl, CTRL.BACKLIGHT) / 1000,
            red: Atomics.load(ctrl, CTRL.LED_RED) / 1000,
            green: Atomics.load(ctrl, CTRL.LED_GREEN) / 1000,
            blue: Atomics.load(ctrl, CTRL.LED_BLUE) / 1000,
        };
    }

    frameCounter() {
        return Atomics.load(this.ctrl, CTRL.FRAME) + Atomics.load(this.ctrl, CTRL.OUTPUTS) * 65536;
    }

    wake() {
        Atomics.add(this.ctrl, CTRL.WAKE, 1);
        Atomics.notify(this.ctrl, CTRL.WAKE);
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }
}
