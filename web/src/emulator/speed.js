// Nanoseconds on an ESP32-2432S028R running CircuitPython 10.3.1, fitted to 28
// benchmarks: per opcode, VM entry, garbage collector step, allocation, map
// lookup and print, per byte sent to the display, and per analog read.
export const NS_PER_COUNT = [280, 2434, 176, 6237, 4958, 63056];
export const NS_PER_DISPLAY_BYTE = 2268;
export const NS_PER_ADC_READ = 184000;

const MIN_SLEEP_MS = 2;
const MAX_CREDIT_MS = 5;
const WINDOW_MS = 1000;
const BUSY_SHARE = 0.3;
const SLOW_BELOW = 0.85;

export class Speed {
    constructor({ sleep, report, enabled = true, costScale = 1 }) {
        this.sleep = sleep;
        this.report = report;
        this.enabled = enabled;
        this.costScale = costScale;
        this.read = () => 0;
        this.counts = NS_PER_COUNT.map(() => 0);
        this.charged = 0;
        this.last = performance.now();
        this.debt = 0;
        this.window = { start: this.last, cost: 0, idle: 0, slept: 0 };
        this.slow = null;
    }

    counters(read) {
        this.read = read;
        this.counts = this.counts.map((_, i) => read(i));
    }

    charge(ns) {
        this.charged += ns;
    }

    idled(ms) {
        this.window.idle += ms;
    }

    tick() {
        let ns = this.charged;
        this.charged = 0;
        for (let i = 0; i < this.counts.length; i++) {
            const count = this.read(i);
            ns += ((count - this.counts[i]) >>> 0) * NS_PER_COUNT[i];
            this.counts[i] = count;
        }
        const cost = (ns / 1e6) * this.costScale;
        const now = performance.now();
        this.debt = Math.max(-MAX_CREDIT_MS, this.debt + cost - (now - this.last));
        this.last = now;
        this.window.cost += cost;
        if (this.enabled && this.debt >= MIN_SLEEP_MS) {
            this.sleep(this.debt);
            this.window.slept += performance.now() - now;
        }
        if (performance.now() - this.window.start >= WINDOW_MS) {
            this.judge();
        }
    }

    judge() {
        const { start, cost, idle, slept } = this.window;
        const end = performance.now();
        const length = end - start;
        const busy = length - idle - slept;
        if (cost >= length * BUSY_SHARE && slept < cost * 0.05 && busy > 0) {
            const ratio = Math.min(1, cost / busy);
            this.setSlow(ratio < SLOW_BELOW ? ratio : null);
        } else {
            this.setSlow(null);
        }
        this.window = { start: end, cost: 0, idle: 0, slept: 0 };
    }

    setSlow(ratio) {
        const changed = (ratio === null) !== (this.slow === null) || (ratio !== null && Math.abs(ratio - this.slow) > 0.05);
        if (changed) {
            this.slow = ratio;
            this.report(ratio);
        }
    }

    stats() {
        return this.counts.map((_, i) => this.read(i));
    }
}
