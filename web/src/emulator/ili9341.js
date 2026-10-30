import { SCREEN_WIDTH } from './shared.js';

const PANEL_COLS = 240;
const PANEL_ROWS = 320;

const MY = 0x80;
const MX = 0x40;
const MV = 0x20;
const BGR = 0x08;

export class ILI9341 {
    constructor(framebuffer, onChange) {
        this.fb = framebuffer;
        this.onChange = onChange;
        this.reset();
    }

    reset() {
        this.command = -1;
        this.params = [];
        this.madctl = 0;
        this.inverted = false;
        this.sleeping = true;
        this.displayOn = false;
        this.colStart = 0;
        this.colEnd = PANEL_COLS - 1;
        this.pageStart = 0;
        this.pageEnd = PANEL_ROWS - 1;
        this.col = 0;
        this.page = 0;
        this.pendingByte = -1;
        this.fb.fill(0);
        for (let i = 3; i < this.fb.length; i += 4) {
            this.fb[i] = 255;
        }
        this.onChange();
    }

    get visible() {
        return this.displayOn && !this.sleeping;
    }

    write(bytes, isData) {
        if (!isData) {
            for (let i = 0; i < bytes.length; i++) {
                this.startCommand(bytes[i]);
            }
            return;
        }
        if (this.command === 0x2c || this.command === 0x3c) {
            this.writePixels(bytes);
            return;
        }
        for (let i = 0; i < bytes.length; i++) {
            this.params.push(bytes[i]);
            this.applyParams();
        }
    }

    startCommand(cmd) {
        this.command = cmd;
        this.params = [];
        this.pendingByte = -1;
        switch (cmd) {
            case 0x01:
                this.reset();
                this.command = 0x01;
                break;
            case 0x10:
                this.sleeping = true;
                this.onChange();
                break;
            case 0x11:
                this.sleeping = false;
                this.onChange();
                break;
            case 0x20:
                this.inverted = false;
                this.onChange();
                break;
            case 0x21:
                this.inverted = true;
                this.onChange();
                break;
            case 0x28:
                this.displayOn = false;
                this.onChange();
                break;
            case 0x29:
                this.displayOn = true;
                this.onChange();
                break;
            case 0x2c:
                this.col = this.colStart;
                this.page = this.pageStart;
                break;
            default:
                break;
        }
    }

    applyParams() {
        const p = this.params;
        switch (this.command) {
            case 0x2a:
                if (p.length === 4) {
                    this.colStart = (p[0] << 8) | p[1];
                    this.colEnd = (p[2] << 8) | p[3];
                }
                break;
            case 0x2b:
                if (p.length === 4) {
                    this.pageStart = (p[0] << 8) | p[1];
                    this.pageEnd = (p[2] << 8) | p[3];
                }
                break;
            case 0x36:
                if (p.length === 1) {
                    this.madctl = p[0];
                }
                break;
            default:
                break;
        }
    }

    writePixels(bytes) {
        let i = 0;
        if (this.pendingByte >= 0 && bytes.length > 0) {
            this.putPixel((this.pendingByte << 8) | bytes[0]);
            this.pendingByte = -1;
            i = 1;
        }
        for (; i + 1 < bytes.length; i += 2) {
            this.putPixel((bytes[i] << 8) | bytes[i + 1]);
        }
        if (i < bytes.length) {
            this.pendingByte = bytes[i];
        }
        this.onChange();
    }

    putPixel(color) {
        const mad = this.madctl;
        let x;
        let y;
        if (mad & MV) {
            x = this.page;
            y = this.col;
        } else {
            x = this.col;
            y = this.page;
        }
        if (mad & MX) {
            x = PANEL_COLS - 1 - x;
        }
        if (mad & MY) {
            y = PANEL_ROWS - 1 - y;
        }
        if (x >= 0 && x < PANEL_COLS && y >= 0 && y < PANEL_ROWS) {
            const offset = (x * SCREEN_WIDTH + y) * 4;
            let r = (color >> 11) & 0x1f;
            const g = (color >> 5) & 0x3f;
            let b = color & 0x1f;
            // The CYD's panel has BGR subpixels.
            if (!(mad & BGR)) {
                const t = r;
                r = b;
                b = t;
            }
            let R = (r << 3) | (r >> 2);
            let G = (g << 2) | (g >> 4);
            let B = (b << 3) | (b >> 2);
            if (this.inverted) {
                R = 255 - R;
                G = 255 - G;
                B = 255 - B;
            }
            this.fb[offset] = R;
            this.fb[offset + 1] = G;
            this.fb[offset + 2] = B;
        }
        this.col++;
        if (this.col > this.colEnd) {
            this.col = this.colStart;
            this.page++;
            if (this.page > this.pageEnd) {
                this.page = this.pageStart;
            }
        }
    }
}
