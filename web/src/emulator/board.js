import { CTRL } from './shared.js';
import { ILI9341 } from './ili9341.js';
import { XPT2046 } from './xpt2046.js';
import { SDCard } from './sdcard.js';
import { adcMillivolts, lightSensorMillivolts } from './analog.js';

const PIN = {
    BOOT: 0,
    LCD_DC: 2,
    LED_RED: 4,
    SD_CS: 5,
    LCD_MISO: 12,
    LCD_MOSI: 13,
    LCD_SCK: 14,
    LCD_CS: 15,
    LED_GREEN: 16,
    LED_BLUE: 17,
    SD_SCK: 18,
    LCD_BACKLIGHT: 21,
    TOUCH_SCK: 25,
    SPEAKER: 26,
    TOUCH_MOSI: 32,
    TOUCH_CS: 33,
    LDR: 34,
    TOUCH_IRQ: 36,
    TOUCH_MISO: 39,
};

const MODE_DISABLED = 0;
const MODE_INPUT = 1;
const MODE_OUTPUT = 2;
const MODE_OPEN_DRAIN = 3;

const PULL_UP = 1;
const PULL_DOWN = 2;

export class CYDBoard {
    constructor({ ctrl, framebuffer }, card) {
        this.ctrl = ctrl;
        this.mode = new Uint8Array(40);
        this.pull = new Uint8Array(40);
        this.level = new Uint8Array(40);
        this.pwmDuty = new Int32Array(40).fill(-1); // -1 when the pin isn't running PWM.
        this.dac = new Int32Array(40).fill(-1);

        this.display = new ILI9341(framebuffer, () => {
            Atomics.add(ctrl, CTRL.FRAME, 1);
        });
        this.touch = new XPT2046(() => ({
            pressed: Atomics.load(ctrl, CTRL.TOUCH_PRESSED) !== 0,
            x: Atomics.load(ctrl, CTRL.TOUCH_X),
            y: Atomics.load(ctrl, CTRL.TOUCH_Y),
        }));
        this.lastDisplayOn = -1;
        this.sd = new SDCard(card ?? { sectors: 0, blocks: new Map() });
        this.sdWasInserted = false;
    }

    get sdInserted() {
        return Atomics.load(this.ctrl, CTRL.SD_INSERTED) === 1 && this.sd.sectors > 0;
    }

    gpioConfig(pin, mode, pull) {
        this.mode[pin] = mode;
        this.pull[pin] = pull;
        if (mode === MODE_DISABLED) {
            this.pwmDuty[pin] = -1;
        }
        this.updateOutputs();
    }

    gpioSet(pin, value) {
        this.level[pin] = value ? 1 : 0;
        this.updateOutputs();
    }

    gpioGet(pin) {
        const mode = this.mode[pin];
        if (mode === MODE_OUTPUT) {
            return this.level[pin] === 1;
        }
        const external = this.externalLevel(pin);
        if (mode === MODE_OPEN_DRAIN && this.level[pin] === 0) {
            return false;
        }
        if (external !== null) {
            return external;
        }
        return this.pull[pin] === PULL_UP;
    }

    externalLevel(pin) {
        switch (pin) {
            case PIN.BOOT:
                return Atomics.load(this.ctrl, CTRL.BOOT_BUTTON) === 0;
            case PIN.TOUCH_IRQ:
                return !this.touch.irqLow;
            default:
                return null;
        }
    }

    // The RGB LED is common anode, so each colour lights when its pin is low.
    updateOutputs() {
        const ledLevel = (pin) => {
            if (this.pwmDuty[pin] >= 0) {
                return Math.round((1 - this.pwmDuty[pin] / 65535) * 1000);
            }
            const driven = this.mode[pin] === MODE_OUTPUT || this.mode[pin] === MODE_OPEN_DRAIN;
            return driven && this.level[pin] === 0 ? 1000 : 0;
        };
        let backlight;
        if (this.pwmDuty[PIN.LCD_BACKLIGHT] >= 0) {
            backlight = Math.round((this.pwmDuty[PIN.LCD_BACKLIGHT] / 65535) * 1000);
        } else {
            backlight = this.mode[PIN.LCD_BACKLIGHT] === MODE_OUTPUT && this.level[PIN.LCD_BACKLIGHT] ? 1000 : 0;
        }
        const values = [
            [CTRL.LED_RED, ledLevel(PIN.LED_RED)],
            [CTRL.LED_GREEN, ledLevel(PIN.LED_GREEN)],
            [CTRL.LED_BLUE, ledLevel(PIN.LED_BLUE)],
            [CTRL.BACKLIGHT, backlight],
            [CTRL.DISPLAY_ON, this.display.visible ? 1 : 0],
        ];
        let changed = false;
        for (const [slot, value] of values) {
            if (Atomics.load(this.ctrl, slot) !== value) {
                Atomics.store(this.ctrl, slot, value);
                changed = true;
            }
        }
        if (changed) {
            Atomics.add(this.ctrl, CTRL.OUTPUTS, 1);
        }
    }

    spiConfig() {}

    spiTransfer(sck, out, into, len, writeValue) {
        if (sck === PIN.LCD_SCK) {
            if (this.gpioGet(PIN.LCD_CS)) {
                fill(into, 0xff);
                return;
            }
            if (out) {
                this.display.write(out, this.gpioGet(PIN.LCD_DC));
                const on = this.display.visible ? 1 : 0;
                if (on !== this.lastDisplayOn) {
                    this.lastDisplayOn = on;
                    this.updateOutputs();
                }
            }
            fill(into, 0);
            return;
        }
        if (sck === PIN.TOUCH_SCK) {
            if (this.gpioGet(PIN.TOUCH_CS)) {
                fill(into, 0);
                return;
            }
            this.touch.transfer(out, into, len, writeValue);
            return;
        }
        if (sck === PIN.SD_SCK && this.sdInserted) {
            if (!this.sdWasInserted) {
                this.sdWasInserted = true;
                this.sd.powerOn();
            }
            if (this.gpioGet(PIN.SD_CS)) {
                fill(into, 0xff);
                return;
            }
            this.sd.transfer(out, into, len, writeValue);
            return;
        }
        if (sck === PIN.SD_SCK) {
            this.sdWasInserted = false;
        }
        fill(into, 0xff);
    }

    i2cWrite() {
        return -19;
    }

    i2cRead() {
        return -19;
    }

    pwmSet(pin, duty, frequency) {
        this.pwmDuty[pin] = frequency === 0 ? -1 : duty;
        this.updateOutputs();
    }

    adcRead(pin) {
        return adcMillivolts(this.pinMillivolts(pin));
    }

    pinMillivolts(pin) {
        if (pin === PIN.LDR) {
            const lux = Atomics.load(this.ctrl, CTRL.LIGHT_MICROLUX) / 1e6;
            return lightSensorMillivolts(lux, Atomics.load(this.ctrl, CTRL.BACKLIGHT) / 1000);
        }
        if (this.dac[pin] >= 0) {
            return Math.round((this.dac[pin] / 255) * 3300);
        }
        return this.gpioGet(pin) ? 3100 : 0;
    }

    dacWrite(pin, value) {
        this.dac[pin] = value;
    }

    reset() {
        this.mode.fill(0);
        this.pull.fill(0);
        this.level.fill(0);
        this.pwmDuty.fill(-1);
        this.dac.fill(-1);
        this.display.reset();
        this.touch.reset();
        this.updateOutputs();
    }
}

function fill(into, value) {
    if (into) {
        into.fill(value);
    }
}
