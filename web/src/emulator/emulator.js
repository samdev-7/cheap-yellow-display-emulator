import { CTRL, RESET_REASON, SERIAL_SIZE, createShared, packCard, views } from './shared.js';
import { lightSensorMillivolts } from './analog.js';

const MIN_TOUCH_MS = 150;
const WAKE_BOOT_MS = 300;

export class Emulator extends EventTarget {
    constructor({ firmwareUrl, esp32Speed = 1 }) {
        super();
        this.esp32Speed = esp32Speed;
        this.firmwareUrl = new URL(firmwareUrl, location.href).href;
        this.sab = createShared();
        this.shared = views(this.sab);
        this.worker = null;
        this.sleeping = null; // { pins, values, timer } in deep sleep
        Atomics.store(this.shared.ctrl, CTRL.LIGHT_MV, Math.round(lightSensorMillivolts(70)));
    }

    get ctrl() {
        return this.shared.ctrl;
    }

    get framebuffer() {
        return this.shared.framebuffer;
    }

    start(files, card, { reason = RESET_REASON.POWER_ON, wake = null } = {}) {
        this.stop();
        this.cancelSleep();
        const ctrl = this.ctrl;
        Atomics.store(ctrl, CTRL.RESET_REASON, reason);
        Atomics.store(ctrl, CTRL.WAKE_KIND, wake?.kind ?? 0);
        Atomics.store(ctrl, CTRL.WAKE_PIN, wake?.pin ?? 0);
        Atomics.store(ctrl, CTRL.WAKE_VALUE, wake?.value ?? 0);
        if (reason === RESET_REASON.POWER_ON) {
            this.shared.sleepMemory.fill(0);
        }
        for (const slot of [CTRL.SERIAL_HEAD, CTRL.SERIAL_TAIL, CTRL.CTRL_C]) {
            Atomics.store(ctrl, slot, 0);
        }
        this.network?.reset();
        this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event) => this.onWorkerMessage(event.data);
        this.worker.onerror = (event) => {
            this.emit('state', { running: false, message: `Emulator failed to start: ${event.message}` });
        };
        this.worker.postMessage({ type: 'start', sab: this.sab, firmwareUrl: this.firmwareUrl, files, card, costScale: 1 / this.esp32Speed });
        this.emit('state', { running: true, message: 'Starting…' });
    }

    stop() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.emit('speed', { ratio: null });
    }

    powerOff() {
        this.stop();
        this.cancelSleep();
        this.darken();
        this.emit('state', { running: false, message: 'Power off' });
    }

    darken() {
        const ctrl = this.ctrl;
        for (const slot of [CTRL.DISPLAY_ON, CTRL.BACKLIGHT, CTRL.LED_RED, CTRL.LED_GREEN, CTRL.LED_BLUE]) {
            Atomics.store(ctrl, slot, 0);
        }
        this.framebuffer.fill(0);
        Atomics.add(ctrl, CTRL.FRAME, 1);
        Atomics.add(ctrl, CTRL.OUTPUTS, 1);
    }

    get powered() {
        return this.worker !== null || this.sleeping !== null || Boolean(this.waking);
    }

    sleep({ timeMs, pins, values }) {
        this.stop();
        this.darken();
        this.sleeping = { pins, values, timer: 0 };
        if (timeMs >= 0) {
            this.sleeping.timer = setTimeout(() => this.wakeUp({ kind: 1 }), timeMs);
        }
        const waits = [];
        if (timeMs >= 0) waits.push(`in ${timeMs >= 10000 ? Math.round(timeMs / 1000) : (timeMs / 1000).toFixed(1)} s`);
        if (pins.includes(0)) waits.push('on BOOT');
        if (pins.includes(36)) waits.push('on a touch');
        this.emit('state', { running: false, message: waits.length ? `Deep sleep: wakes ${waits.join(' or ')}` : 'Deep sleep, with nothing to wake it' });
        this.checkPins();
    }

    checkPins() {
        if (!this.sleeping) return;
        const levels = {
            0: Atomics.load(this.ctrl, CTRL.BOOT_BUTTON) ? 0 : 1,
            36: Atomics.load(this.ctrl, CTRL.TOUCH_PRESSED) ? 0 : 1,
        };
        const { pins, values } = this.sleeping;
        for (let i = 0; i < pins.length; i++) {
            if (levels[pins[i]] === values[i]) {
                this.wakeUp({ kind: 2, pin: pins[i], value: values[i] });
                return;
            }
        }
    }

    wakeUp(wake) {
        this.cancelSleep();
        this.waking = setTimeout(() => {
            this.waking = 0;
            this.emit('wake-requested', { wake });
        }, WAKE_BOOT_MS);
    }

    cancelSleep() {
        clearTimeout(this.waking);
        this.waking = 0;
        if (this.sleeping) {
            clearTimeout(this.sleeping.timer);
            this.sleeping = null;
        }
    }

    nvmSnapshot() {
        const nvm = this.shared.nvm;
        return nvm.some((byte) => byte !== 0) ? nvm.slice() : null;
    }

    setNvm(bytes) {
        this.shared.nvm.fill(0);
        if (bytes) {
            this.shared.nvm.set(bytes.subarray(0, this.shared.nvm.length));
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
                this.emit('files-applied', { errors: message.errors });
                break;
            case 'sd-blocks':
                if (message.generation === Atomics.load(this.ctrl, CTRL.SD_GENERATION)) {
                    this.emit('sd-blocks', message.blocks);
                }
                break;
            case 'nvm':
                this.emit('nvm');
                break;
            case 'restart':
                this.emit('reset-requested', { reason: message.reason });
                break;
            case 'deep-sleep':
                this.sleep(message);
                break;
            case 'speed':
                this.emit('speed', { ratio: message.ratio });
                break;
            case 'reset':
                this.emit('reset-requested', { toBootloader: message.toBootloader });
                break;
            case 'crashed':
                this.emit('state', { running: false, message: `CircuitPython stopped: ${message.message}` });
                break;
            default:
                this.network?.handle(message);
                break;
        }
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

    setTouch(pressed, x = 0, y = 0) {
        const ctrl = this.ctrl;
        Atomics.store(ctrl, CTRL.TOUCH_X, Math.round(x));
        Atomics.store(ctrl, CTRL.TOUCH_Y, Math.round(y));
        clearTimeout(this.releaseTimer);
        if (pressed) {
            if (Atomics.load(ctrl, CTRL.TOUCH_PRESSED) === 0) {
                this.touchStart = performance.now();
            }
            Atomics.store(ctrl, CTRL.TOUCH_PRESSED, 1);
        } else {
            const held = performance.now() - (this.touchStart ?? 0);
            const release = () => {
                Atomics.store(ctrl, CTRL.TOUCH_PRESSED, 0);
                this.checkPins();
            };
            if (held >= MIN_TOUCH_MS) {
                release();
            } else {
                this.releaseTimer = setTimeout(release, MIN_TOUCH_MS - held);
            }
        }
        this.wake();
        this.checkPins();
    }

    setWifiMode(mode) {
        Atomics.store(this.ctrl, CTRL.WIFI_MODE, mode);
        this.wake();
    }

    dropWifi() {
        Atomics.add(this.ctrl, CTRL.WIFI_DROP, 1);
        this.wake();
    }

    setBootButton(pressed) {
        Atomics.store(this.ctrl, CTRL.BOOT_BUTTON, pressed ? 1 : 0);
        this.wake();
        this.checkPins();
    }

    setCardInserted(inserted) {
        Atomics.store(this.ctrl, CTRL.SD_INSERTED, inserted ? 1 : 0);
        this.wake();
    }

    replaceCard(card) {
        if (this.worker) {
            packCard(card, this.shared.sdArea);
        }
        Atomics.add(this.ctrl, CTRL.SD_GENERATION, 1);
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
