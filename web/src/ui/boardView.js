import frontSvg from '../assets/board-front.svg?raw';
import backSvg from '../assets/board-back.svg?raw';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../emulator/shared.js';
import { analogInValue, lightLux, lightSensorMillivolts } from '../emulator/analog.js';

const [VIEW_W, VIEW_H] = frontSvg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/).slice(1).map(Number);

const FRONT_RESET = { x: 82.0, y: 12.0 };
const FRONT_BOOT = { x: 82.0, y: 21.5 };
const FRONT_LED = { x: 82.0, y: 34.0, size: 5.0, lens: 1.7 };
const LIGHT_DIAL = { y: 38.0, size: 5.6 };

const percent = (value, total) => `${(value / total) * 100}%`;

function place(element, x, y, w, h) {
    element.style.left = percent(x - w / 2, VIEW_W);
    element.style.top = percent(y - h / 2, VIEW_H);
    element.style.width = percent(w, VIEW_W);
    element.style.height = percent(h, VIEW_H);
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
    const element = document.createElement('div');
    element.className = `board-face ${className}`;
    element.innerHTML = svgText.replace(/<\?xml[^>]*>\s*/, '');
    const svg = element.querySelector('svg');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('aria-hidden', 'true');
    const overlay = document.createElement('div');
    overlay.className = 'board-overlay';
    const glow = document.createElement('div');
    glow.className = 'board-glow';
    element.append(overlay, glow);
    return { element, svg, overlay, glow };
}

function formatLux(lux) {
    if (lux === 0) return 'dark';
    return `${lux < 10 ? lux.toPrecision(1) : Math.round(lux).toLocaleString()} lux`;
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
        this.flipper = document.createElement('div');
        this.flipper.className = 'board-flipper';
        host.append(this.flipper);

        this.front = face('front', frontSvg);
        this.back = face('back', backSvg);
        this.back.element.hidden = true;
        this.flipper.append(this.front.element, this.back.element);

        this.tip = document.createElement('div');
        this.tip.className = 'board-tip';
        this.tip.id = 'board-tip';
        this.tip.setAttribute('role', 'tooltip');
        this.tip.hidden = true;
        host.append(this.tip);
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
        this.canvas = document.createElement('canvas');
        this.canvas.width = SCREEN_WIDTH;
        this.canvas.height = SCREEN_HEIGHT;
        this.canvas.className = 'board-screen';
        this.canvas.setAttribute('aria-label', 'Board display. Click or drag to touch the screen.');
        place(this.canvas, area.x, area.y, area.w, area.h);
        this.dim = document.createElement('div');
        this.dim.className = 'board-screen-dim';
        place(this.dim, area.x, area.y, area.w, area.h);
        overlay.append(this.canvas, this.dim);
        this.attachTouch();

        const reset = this.button('RST', 'Reset: restart the board from power-on');
        place(reset, FRONT_RESET.x, FRONT_RESET.y, 5.2, 5.2);
        const boot = this.button('BOOT', 'BOOT button (board.BUTTON, GPIO0). Hold to press.');
        place(boot, FRONT_BOOT.x, FRONT_BOOT.y, 5.2, 5.2);
        overlay.append(reset, boot);
        this.wireReset(reset);
        this.wireBoot(boot);

        const ldr = boxOf(svg, '#ldr');
        overlay.append(this.lightDial(ldr.x, LIGHT_DIAL.y));

        const led = this.led(this.front, FRONT_LED.x, FRONT_LED.y, FRONT_LED.size, FRONT_LED.size, FRONT_LED.lens, true);
        overlay.append(led.element);
    }

    buildBack() {
        const { svg, overlay } = this.back;

        for (const [id, label, title] of [
            ['reset', 'RESET', 'Reset: restart the board from power-on'],
            ['boot', 'BOOT', 'BOOT button (board.BUTTON, GPIO0). Hold to press.'],
        ]) {
            const body = boxOf(svg, `#button-${id}`);
            const cap = boxOf(svg, `#button-${id}-cap`);
            const button = document.createElement('button');
            button.className = 'board-hotspot';
            button.title = title;
            button.setAttribute('aria-label', title);
            place(button, body.x, body.y, body.w, body.h);
            const pressedCap = document.createElement('span');
            pressedCap.className = 'board-hotspot-cap';
            pressedCap.style.left = percent(cap.x - (body.x - body.w / 2) - cap.w / 2, body.w);
            pressedCap.style.top = percent(cap.y - (body.y - body.h / 2) - cap.h / 2, body.h);
            pressedCap.style.width = percent(cap.w, body.w);
            pressedCap.style.height = percent(cap.h, body.h);
            button.append(pressedCap);
            const silk = document.createElement('span');
            silk.className = 'board-silk';
            silk.textContent = label;
            silk.style.left = percent(body.x, VIEW_W);
            silk.style.top = percent(body.y + body.h / 2 + 0.6, VIEW_H);
            overlay.append(button, silk);
            if (id === 'reset') {
                this.wireReset(button);
            } else {
                this.wireBoot(button);
            }
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
        const element = document.createElement('div');
        element.className = 'board-cable';
        element.hidden = true;
        element.setAttribute('aria-hidden', 'true');
        const part = (className, start, end, height) => {
            const piece = document.createElement('div');
            piece.className = className;
            const x0 = edge + dir * start;
            const x1 = edge + dir * end;
            place(piece, (x0 + x1) / 2, y, Math.abs(x1 - x0), height);
            element.append(piece);
        };
        part('board-cable-cord', 20, 400, 3.2); // Long enough to run off any panel.
        part('board-cable-relief', 15, 21, 4.6);
        part('board-cable-plug', 1.2, 16, 10.4);
        part('board-cable-tip', -0.4, 1.4, 6.8);
        overlay.append(element);
        const plug = document.createElement('button');
        plug.className = 'board-cable-hotspot';
        place(plug, edge + dir * 8, y, 18, 10.4);
        plug.addEventListener('click', () => this.onPower());
        element.addEventListener('click', () => this.onPower());
        overlay.append(plug);
        this.plugs = [...(this.plugs ?? []), plug];
        return element;
    }

    buildCards() {
        this.cards = [this.front, this.back].map((face) => {
            const end = boxOf(face.svg, '#sd-card');
            const card = document.createElement('div');
            card.className = 'board-sdcard';
            card.hidden = true;
            card.setAttribute('aria-hidden', 'true');
            place(card, end.x, end.y, end.w, end.h);
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

    button(label, title) {
        const button = document.createElement('button');
        button.className = 'board-button';
        button.title = title;
        button.setAttribute('aria-label', title);
        const tag = document.createElement('span');
        tag.className = 'board-button-label';
        tag.textContent = label;
        button.append(tag);
        return button;
    }

    wireReset(button) {
        button.addEventListener('click', () => this.onReset());
    }

    wireBoot(button) {
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
    }

    led(side, x, y, w, h, lensR, drawPackage) {
        const element = document.createElement('div');
        element.className = 'board-led';
        this.attachTip(element, () => this.ledTip());
        place(element, x, y, w, h);
        const lens = document.createElement('div');
        lens.className = 'board-led-lens';
        lens.style.width = percent(2 * lensR, w);
        lens.style.height = percent(2 * lensR, h);
        if (drawPackage) {
            const body = document.createElement('div');
            body.className = 'board-led-package';
            element.append(body);
        }
        element.append(lens);
        const bloom = document.createElement('div');
        bloom.className = 'board-led-bloom';
        const size = lensR * 2 * 7;
        place(bloom, x, y, size, size);
        side.glow.append(bloom);
        const state = { element, lens, bloom };
        this.leds.push(state);
        return state;
    }

    ledTip() {
        const { red, green, blue } = this.ledOutputs;
        const percent = (value) => `${Math.round(value * 100)}%`;
        const state = Math.max(red, green, blue) > 0 ? `Red ${percent(red)} · Green ${percent(green)} · Blue ${percent(blue)}` : 'Off';
        return ['RGB LED', state, 'board.LED_RED, LED_GREEN, LED_BLUE'];
    }

    showLeds(out) {
        this.ledOutputs = out;
        this.refreshTip();
        const level = Math.max(out.red, out.green, out.blue);
        for (const { element, lens, bloom } of this.leds) {
            if (level <= 0) {
                element.classList.remove('lit');
                lens.style.background = '';
                bloom.style.opacity = '0';
                continue;
            }
            const hue = `rgb(${Math.round((out.red / level) * 255)} ${Math.round((out.green / level) * 255)} ${Math.round((out.blue / level) * 255)})`;
            element.classList.add('lit');
            bloom.style.setProperty('--led', hue);
            lens.style.background = `color-mix(in srgb, ${hue} ${Math.round(35 + level * 65)}%, #fbf6e4)`;
            bloom.style.opacity = String(Math.min(1, 0.2 + level * 0.8));
            bloom.style.transform = `scale(${0.35 + level * 0.65})`;
        }
    }

    lightDial(x, y) {
        const dial = document.createElement('div');
        dial.className = 'board-light';
        dial.tabIndex = 0;
        dial.setAttribute('role', 'slider');
        dial.setAttribute('aria-label', 'Light on the light sensor');
        dial.setAttribute('aria-valuemin', '0');
        dial.setAttribute('aria-valuemax', '100');
        place(dial, x, y, LIGHT_DIAL.size, LIGHT_DIAL.size);
        const value = document.createElement('span');
        value.className = 'board-light-value';
        dial.append(value);

        let level = 70;
        let reading = null;
        this.attachTip(dial, () => ['Light sensor', `${reading.lux} · AnalogIn reads ${reading.value}`, 'Drag, scroll or use the arrow keys']);
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

    flip() {
        return this.setSide(!this.showingBack);
    }

    setSide(back) {
        this.showingBack = back;
        this.front.element.hidden = back;
        this.back.element.hidden = !back;
        return back;
    }

    attachTip(target, lines) {
        target.addEventListener('pointerenter', () => this.showTip(target, lines));
        target.addEventListener('pointerleave', () => this.hideTip(target));
        target.addEventListener('focus', () => this.showTip(target, lines));
        target.addEventListener('blur', () => this.hideTip(target));
        if (target.tabIndex >= 0) {
            target.setAttribute('aria-describedby', this.tip.id);
        }
    }

    showTip(target, lines) {
        this.tipTarget = target;
        this.tipLines = lines;
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
        const [title, ...details] = this.tipLines();
        const text = [title, ...details].join('\n');
        if (text !== this.tipText) {
            this.tipText = text;
            this.tip.replaceChildren();
            const heading = document.createElement('strong');
            heading.textContent = title;
            this.tip.append(heading);
            details.forEach((detail, index) => {
                const line = document.createElement('span');
                line.textContent = detail;
                if (index === details.length - 1 && details.length > 1) line.className = 'board-tip-hint';
                this.tip.append(line);
            });
        }
        const host = this.host.getBoundingClientRect();
        const target = this.tipTarget.getBoundingClientRect();
        const half = this.tip.offsetWidth / 2;
        const centre = target.left + target.width / 2 - host.left;
        this.tip.style.left = `${Math.min(Math.max(centre, half + 4), host.width - half - 4)}px`;
        this.tip.style.top = `${target.top - host.top}px`;
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
        this.dim.style.opacity = String(1 - (out.displayOn ? out.backlight : 0));
        this.showLeds(out);
    }
}
