// MicroPython 1.25 fibo(30) and bubble sort on an ESP32-S3 (Miguel Grinberg),
// times 1.15 for the 240 MHz ESP32 (Peter Scruss, 2025).
export const NS_PER_OPCODE = 411;
export const NS_PER_CALL = 8700;

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
        this.readOpcodes = () => 0;
        this.readCalls = () => 0;
        this.opcodes = 0;
        this.calls = 0;
        this.last = performance.now();
        this.debt = 0;
        this.window = { start: this.last, cost: 0, idle: 0, slept: 0 };
        this.slow = null;
    }

    counters(readOpcodes, readCalls) {
        this.readOpcodes = readOpcodes;
        this.readCalls = readCalls;
        this.opcodes = readOpcodes();
        this.calls = readCalls();
    }

    idled(ms) {
        this.window.idle += ms;
    }

    tick() {
        const opcodes = this.readOpcodes();
        const calls = this.readCalls();
        const cost = ((((opcodes - this.opcodes) >>> 0) * NS_PER_OPCODE + ((calls - this.calls) >>> 0) * NS_PER_CALL) / 1e6) * this.costScale;
        this.opcodes = opcodes;
        this.calls = calls;
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
        return { opcodes: this.readOpcodes(), calls: this.readCalls() };
    }
}
