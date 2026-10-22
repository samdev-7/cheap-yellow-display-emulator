const RAW_X_MIN = 200;
const RAW_X_MAX = 3700;
const RAW_Y_MIN = 240;
const RAW_Y_MAX = 3800;

export class XPT2046 {
    constructor(touch) {
        this.touch = touch;
        this.shift = 0; // 16-bit output shift register, MSB first.
    }

    get irqLow() {
        return this.touch().pressed;
    }

    reset() {
        this.shift = 0;
    }

    transfer(out, into, len, writeValue) {
        for (let i = 0; i < len; i++) {
            const sent = out ? out[i] : writeValue;
            const reply = (this.shift >> 8) & 0xff;
            this.shift = (this.shift << 8) & 0xffff;
            if (sent & 0x80) {
                this.shift = (this.convert((sent >> 4) & 0x07) & 0x0fff) << 3;
            }
            if (into) {
                into[i] = reply;
            }
        }
    }

    convert(channel) {
        const t = this.touch();
        const noise = () => Math.round((Math.random() - 0.5) * 6);
        switch (channel) {
            case 0b001: // Y position input, which follows the screen's x axis here.
                if (!t.pressed) return 0;
                return clamp(RAW_X_MIN + (t.x / 319) * (RAW_X_MAX - RAW_X_MIN) + noise());
            case 0b101: // X position input, which follows the screen's y axis here.
                if (!t.pressed) return 0;
                return clamp(RAW_Y_MIN + (t.y / 239) * (RAW_Y_MAX - RAW_Y_MIN) + noise());
            case 0b011: // Z1: touch pressure.
                return t.pressed ? clamp(600 + noise()) : 0;
            case 0b100: // Z2: touch pressure.
                return t.pressed ? clamp(3400 + noise()) : 4095;
            case 0b000: // Temperature, around room temperature.
                return 600;
            case 0b010: // Battery input, unconnected on the CYD.
            case 0b110: // Auxiliary input, unconnected on the CYD.
            default:
                return 0;
        }
    }
}

function clamp(v) {
    return Math.max(0, Math.min(4095, Math.round(v)));
}
