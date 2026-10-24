import frontSvg from '../assets/board-front.svg?raw';
import backSvg from '../assets/board-back.svg?raw';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../emulator/shared.js';
import { analogInValue, lightLux, lightSensorMillivolts } from '../emulator/analog.js';
import { el } from './el.js';

const [VIEW_W, VIEW_H] = frontSvg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/).slice(1).map(Number);

const FRONT_RESET = { x: 82.0, y: 12.0 };
const FRONT_BOOT = { x: 82.0, y: 21.5 };
const FRONT_LED = { x: 82.0, y: 34.0, size: 5.0, lens: 1.7 };
const LIGHT_DIAL = { y: 38.0, size: 5.6 };

const percent = (value, total) => `${(value / total) * 100}%`;

function place(element, x, y, w, h, viewW = VIEW_W, viewH = VIEW_H) {
    Object.assign(element.style, {
        left: percent(x - w / 2, viewW),
        top: percent(y - h / 2, viewH),
        width: percent(w, viewW),
        height: percent(h, viewH),
    });
    return element;
}

function boxOf(svg, selector) {
    const el = svg.querySelector(selector);
    if (el.tagName === 'circle') {
        const r = Number(el.getAttribute('r'));
        return { x: Number(el.getAttribute('cx')), y: Number(el.getAttribute('cy')), w: 2 * r, h: 2 * r };
    }
    const w = Number(el.getAttribute('width'));
    const h = Number(el.getAttribute('height'));
    return { x: Number(el.getAttribute('x')) + w / 2, y: Number(el.getAttribute('y')) + h / 2, w, h };
}

function face(className, svgText) {
    const overlay = el('div', { className: 'board-overlay' });
    const glow = el('div', { className: 'board-glow' });
    const element = el('div', { className: `board-face ${className}`, innerHTML: svgText.replace(/<\?xml[^>]*>\s*/, '') });
    element.append(overlay, glow);
    const svg = element.querySelector('svg');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('aria-hidden', 'true');
    return { element, svg, overlay, glow };
}

function srgb(linear) {
    return linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
}

function formatLux(lux) {
    if (lux === 0) return '0 lux';
    return `${lux < 10 ? Number(lux.toPrecision(2)) : Math.round(lux).toLocaleString()} lux`;
}

const BOOT_TAP_MS = 200;

export class BoardView {
    constructor(host, emulator, { onReset, onLight, onPower }) {
        this.emulator = emulator;
        this.onReset = onReset;
        this.onPower = onPower;
        this.onLight = onLight;
        this.host = host;
        host.classList.add('board-view');
        this.front = face('front', frontSvg);
        this.back = face('back', backSvg);
        this.back.element.hidden = true;
        this.tip = el('div', { className: 'board-tip', id: 'board-tip', role: 'tooltip', hidden: true });
        host.append(el('div', { className: 'board-flipper' }, this.front.element, this.back.element), this.tip);
        this.tipTarget = null;

        this.leds = [];
        this.ledOutputs = { red: 0, green: 0, blue: 0 };
        this.buildFront();
        this.buildBack();
        this.buildCables();
        this.buildCards();

        this.showingBack = false;

        this.context = this.canvas.getContext('2d');
        this.image = this.context.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
        this.lastFrame = -1;
        const frame = () => {
            this.render();
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }

    buildFront() {
        const { svg, overlay } = this.front;

        const area = boxOf(svg, '#screen');
        this.canvas = place(
            el('canvas', { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, className: 'board-screen', 'aria-label': 'Board display. Click or drag to touch the screen.' }),
            area.x, area.y, area.w, area.h,
        );
        this.dim = place(el('div', { className: 'board-screen-dim' }), area.x, area.y, area.w, area.h);
        overlay.append(this.canvas, this.dim);
        this.attachTouch();

        for (const [id, label, at] of [['reset', 'RST', FRONT_RESET], ['boot', 'BOOT', FRONT_BOOT]]) {
            const button = el('button', { className: 'board-button' }, el('span', { className: 'board-button-label', textContent: label }));
            overlay.append(this.wireButton(id, place(button, at.x, at.y, 5.2, 5.2)));
        }

        const ldr = boxOf(svg, '#ldr');
        overlay.append(this.lightDial(ldr.x, LIGHT_DIAL.y));

        const led = this.led(this.front, FRONT_LED.x, FRONT_LED.y, FRONT_LED.size, FRONT_LED.size, FRONT_LED.lens, true);
        overlay.append(led.element);
    }

    buildBack() {
        const { svg, overlay } = this.back;

        for (const [id, label] of [['reset', 'RESET'], ['boot', 'BOOT']]) {
            const body = boxOf(svg, `#button-${id}`);
            const cap = boxOf(svg, `#button-${id}-cap`);
            const pressedCap = place(el('span', { className: 'board-hotspot-cap' }), cap.x - body.x + body.w / 2, cap.y - body.y + body.h / 2, cap.w, cap.h, body.w, body.h);
            const button = place(el('button', { className: 'board-hotspot' }, pressedCap), body.x, body.y, body.w, body.h);
            const silk = el('span', { className: 'board-silk', textContent: label });
            Object.assign(silk.style, { left: percent(body.x, VIEW_W), top: percent(body.y + body.h / 2 + 0.6, VIEW_H) });
            overlay.append(this.wireButton(id, button), silk);
        }

        const pkg = boxOf(svg, '#led');
        const lens = boxOf(svg, '#led-lens');
        const led = this.led(this.back, pkg.x, pkg.y, pkg.w, pkg.h, lens.w / 2, false);
        overlay.append(led.element);
    }

    buildCables() {
        const port = boxOf(this.back.svg, '#usb');
        this.cables = [
            this.cable(this.front.overlay, VIEW_W, 1, port.y),
            this.cable(this.back.overlay, 0, -1, port.y),
        ];
    }

    cable(overlay, edge, dir, y) {
        const part = (className, start, end, height) =>
            place(el('div', { className }), edge + (dir * (start + end)) / 2, y, end - start, height);
        const element = el(
            'div',
            { className: 'board-cable', hidden: true, 'aria-hidden': 'true' },
            part('board-cable-cord', 20, 400, 3.2),
            part('board-cable-relief', 15, 21, 4.6),
            part('board-cable-plug', 1.2, 16, 10.4),
            part('board-cable-tip', -0.4, 1.4, 6.8),
        );
        overlay.append(element);
        const plug = place(el('button', { className: 'board-cable-hotspot' }), edge + dir * 8, y, 18, 10.4);
        plug.addEventListener('click', () => this.onPower());
        element.addEventListener('click', () => this.onPower());
        overlay.append(plug);
        this.plugs = [...(this.plugs ?? []), plug];
        return element;
    }

    buildCards() {
        this.cards = [this.front, this.back].map((face) => {
            const end = boxOf(face.svg, '#sd-card');
            const card = place(el('div', { className: 'board-sdcard', hidden: true, 'aria-hidden': 'true' }), end.x, end.y, end.w, end.h);
            if (face === this.front) {
                face.element.prepend(card);
            } else {
                face.overlay.prepend(card);
            }
            return card;
        });
    }

    setCardInserted(inserted) {
        for (const card of this.cards) {
            card.hidden = !inserted;
        }
    }

    setPowered(on) {
        for (const cable of this.cables) {
            cable.hidden = !on;
        }
        for (const plug of this.plugs) {
            plug.title = on ? 'Unplug the USB cable' : 'Plug in the USB cable';
            plug.setAttribute('aria-label', plug.title);
        }
    }

    wireButton(id, button) {
        const title = id === 'reset' ? 'Reset: restart the board from power-on' : 'BOOT button (board.BUTTON, GPIO0). Hold to press.';
        Object.assign(button, { title, tabIndex: 0 });
        button.setAttribute('aria-label', title);
        // Safari doesn't focus a clicked button or tab to one without a tabindex.
        button.addEventListener('pointerdown', () => button.focus());
        if (id === 'reset') {
            button.addEventListener('click', () => this.onReset());
            return button;
        }
        const press = (down) => {
            for (const b of this.bootButtons) {
                b.classList.toggle('pressed', down);
            }
            this.emulator.setBootButton(down);
        };
        this.bootButtons = [...(this.bootButtons ?? []), button];
        button.addEventListener('pointerdown', (event) => {
            button.setPointerCapture(event.pointerId);
            press(true);
        });
        button.addEventListener('pointerup', () => press(false));
        button.addEventListener('pointercancel', () => press(false));
        button.addEventListener('click', (event) => {
            if (event.detail === 0) {
                press(true);
                setTimeout(() => press(false), BOOT_TAP_MS);
            }
        });
        return button;
    }

    led(side, x, y, w, h, lensR, drawPackage) {
        const lens = el('div', { className: 'board-led-lens' });
        Object.assign(lens.style, { width: percent(2 * lensR, w), height: percent(2 * lensR, h) });
        const element = place(el('div', { className: 'board-led' }, ...(drawPackage ? [el('div', { className: 'board-led-package' })] : []), lens), x, y, w, h);
        this.attachTip(element, () => this.ledTip());
        const bloom = place(el('div', { className: 'board-led-bloom' }), x, y, lensR * 14, lensR * 14);
        side.glow.append(bloom);
        const state = { element, lens, bloom };
        this.leds.push(state);
        return state;
    }

    ledTip() {
        const { red, green, blue } = this.ledOutputs;
        return [[red, 'red'], [green, 'green'], [blue, 'blue']].map(([value, channel]) => ({
            text: String(Math.round(value * 255)),
            className: `board-tip-${channel}`,
        }));
    }

    showLeds(out) {
        this.ledOutputs = out;
        this.refreshTip();
        const red = srgb(out.red);
        const green = srgb(out.green);
        const blue = srgb(out.blue);
        const level = Math.max(red, green, blue);
        for (const { element, lens, bloom } of this.leds) {
            if (level <= 0) {
                element.classList.remove('lit');
                lens.style.background = '';
                bloom.style.opacity = '0';
                continue;
            }
            const hue = `rgb(${Math.round((red / level) * 255)} ${Math.round((green / level) * 255)} ${Math.round((blue / level) * 255)})`;
            element.classList.add('lit');
            bloom.style.setProperty('--led', hue);
            lens.style.background = `color-mix(in srgb, ${hue} ${Math.round(35 + level * 65)}%, #fbf6e4)`;
            bloom.style.opacity = String(Math.min(1, 0.2 + level * 0.8));
            bloom.style.transform = `scale(${0.35 + level * 0.65})`;
        }
    }

    lightDial(x, y) {
        const value = el('span', { className: 'board-light-value' });
        const dial = el(
            'div',
            { className: 'board-light', tabIndex: 0, role: 'slider', 'aria-label': 'Light on the light sensor', 'aria-valuemin': '0', 'aria-valuemax': '100' },
            value,
        );
        place(dial, x, y, LIGHT_DIAL.size, LIGHT_DIAL.size);

        let level = 70;
        let reading = null;
        this.attachTip(dial, () => [{ text: reading.lux }, { text: `(${reading.value})` }], { stacked: true });
        const set = (next, fromUser = true) => {
            level = Math.max(0, Math.min(100, Math.round(next)));
            dial.style.setProperty('--level', `${level}%`);
            dial.setAttribute('aria-valuenow', String(level));
            const mv = Math.round(lightSensorMillivolts(level));
            this.emulator.setLightSensorMillivolts(mv);
            value.textContent = String(level);
            reading = { lux: formatLux(lightLux(level)), value: analogInValue(mv) };
            dial.setAttribute('aria-valuetext', `${reading.lux}, AnalogIn reads ${reading.value}`);
            this.refreshTip();
            if (fromUser) {
                this.onLight?.(level);
            }
        };
        set(level, false);
        this.setLight = (next) => set(next, false);

        let startY = 0;
        let startLevel = 0;
        dial.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            dial.focus();
            dial.setPointerCapture(event.pointerId);
            dial.classList.add('active');
            startY = event.clientY;
            startLevel = level;
        });
        dial.addEventListener('pointermove', (event) => {
            if (dial.hasPointerCapture(event.pointerId)) {
                set(startLevel + ((startY - event.clientY) / dial.offsetHeight) * 50);
            }
        });
        const end = () => dial.classList.remove('active');
        dial.addEventListener('pointerup', end);
        dial.addEventListener('pointercancel', end);
        dial.addEventListener('wheel', (event) => {
            event.preventDefault();
            set(level - Math.sign(event.deltaY) * 5);
        });
        dial.addEventListener('keydown', (event) => {
            const step = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 }[event.key];
            if (step) {
                event.preventDefault();
                set(level + step);
            }
        });
        return dial;
    }

    attachTouch() {
        const canvas = this.canvas;
        const at = (event, pressed) => {
            const rect = canvas.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * SCREEN_WIDTH;
            const y = ((event.clientY - rect.top) / rect.height) * SCREEN_HEIGHT;
            this.emulator.setTouch(
                pressed,
                Math.min(SCREEN_WIDTH - 1, Math.max(0, x)),
                Math.min(SCREEN_HEIGHT - 1, Math.max(0, y)),
            );
        };
        let touching = false;
        canvas.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            touching = true;
            canvas.setPointerCapture(event.pointerId);
            at(event, true);
        });
        canvas.addEventListener('pointermove', (event) => {
            if (touching) {
                for (const e of event.getCoalescedEvents?.() ?? [event]) {
                    at(e, true);
                }
            }
        });
        const release = (event) => {
            touching = false;
            at(event, false);
        };
        canvas.addEventListener('pointerup', release);
        canvas.addEventListener('pointercancel', release);
    }

    setSide(back) {
        this.showingBack = back;
        this.front.element.hidden = back;
        this.back.element.hidden = !back;
        return back;
    }

    attachTip(target, parts, { stacked = false } = {}) {
        const show = () => {
            this.tip.classList.toggle('stacked', stacked);
            this.showTip(target, parts);
        };
        target.addEventListener('pointerenter', show);
        target.addEventListener('pointerleave', () => this.hideTip(target));
        target.addEventListener('focus', show);
        target.addEventListener('blur', () => this.hideTip(target));
        if (target.tabIndex >= 0) {
            target.setAttribute('aria-describedby', this.tip.id);
        }
    }

    showTip(target, parts) {
        this.tipTarget = target;
        this.tipParts = parts;
        this.tip.hidden = false;
        this.refreshTip();
    }

    hideTip(target) {
        if (this.tipTarget !== target || target.matches(':hover') || document.activeElement === target) return;
        this.tipTarget = null;
        this.tip.hidden = true;
    }

    refreshTip() {
        if (!this.tipTarget) return;
        const parts = this.tipParts();
        const key = parts.map((part) => part.text).join(' ');
        if (key !== this.tipText) {
            this.tipText = key;
            this.tip.replaceChildren(...parts.map(({ text, className = '' }) => el('span', { textContent: text, className })));
        }
        this.placeTip();
    }

    placeTip() {
        const gap = 6;
        const target = this.tipTarget.getBoundingClientRect();
        const screen = this.canvas.getBoundingClientRect();
        const panel = (this.host.closest('section') ?? this.host).getBoundingClientRect();
        const width = this.tip.offsetWidth;
        const height = this.tip.offsetHeight;
        const middleX = target.left + target.width / 2;
        const middleY = target.top + target.height / 2;
        const spots = [];
        for (const x of [target.left - gap - width, target.right + gap]) {
            for (const y of [middleY - height / 2, target.top, target.bottom - height]) spots.push({ x, y });
        }
        for (const y of [target.top - gap - height, target.bottom + gap]) {
            for (const x of [middleX - width / 2, target.right - width, target.left]) spots.push({ x, y });
        }
        const overlap = ({ x, y }) =>
            Math.max(0, Math.min(x + width, screen.right) - Math.max(x, screen.left)) *
            Math.max(0, Math.min(y + height, screen.bottom) - Math.max(y, screen.top));
        const inside = ({ x, y }) =>
            x >= panel.left + 4 && x + width <= panel.right - 4 && y >= panel.top + 4 && y + height <= panel.bottom - 4;
        const fits = spots.filter(inside);
        const best =
            fits.find((spot) => overlap(spot) === 0) ??
            [...(fits.length ? fits : spots)].sort((a, b) => overlap(a) - overlap(b))[0];
        const host = this.host.getBoundingClientRect();
        this.tip.style.left = `${best.x - host.left}px`;
        this.tip.style.top = `${best.y - host.top}px`;
    }

    render() {
        const frame = this.emulator.frameCounter();
        if (frame === this.lastFrame) {
            return;
        }
        this.lastFrame = frame;
        this.image.data.set(this.emulator.framebuffer);
        this.context.putImageData(this.image, 0, 0);
        const out = this.emulator.outputs();
        this.dim.style.opacity = String(1 - (out.displayOn ? srgb(out.backlight) : 0));
        this.showLeds(out);
    }
}
