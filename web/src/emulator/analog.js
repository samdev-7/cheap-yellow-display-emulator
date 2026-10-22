const SUPPLY_MV = 3300;
const R15 = 1e6;
const R19 = 1e6;

const LDR_AT_10_LUX = 8e3;
const LDR_DARK = 5e5;
const LDR_GAMMA = 0.6;

export function lightLux(level) {
    return level <= 0 ? 0 : LUX_LOW * (LUX_HIGH / LUX_LOW) ** ((level - 1) / 99);
}

export function lightSensorMillivolts(lux, backlight) {
    return millivoltsAt(lux + BACKLIGHT_LEAK_LUX * backlight);
}

function millivoltsAt(lux) {
    const ldr = lux > 0 ? Math.min(LDR_DARK, LDR_AT_10_LUX * (lux / 10) ** -LDR_GAMMA) : LDR_DARK;
    const lower = (R19 * ldr) / (R19 + ldr);
    return (SUPPLY_MV * lower) / (R15 + lower);
}

const VREF = 1100;
const COEFF_A = Math.floor((VREF * 196602) / 4096); // adc1_vref_atten_scale[3]
const COEFF_B = 142; // adc1_vref_atten_offset[3]
const LUT_LOW_THRESH = 2880;
const LUT_STEP = 64;
const LUT_LOW = [2240, 2297, 2352, 2405, 2457, 2512, 2564, 2616, 2664, 2709, 2754, 2795, 2832, 2868, 2903, 2937, 2969, 3000, 3030, 3060];
const LUT_HIGH = [2667, 2706, 2745, 2780, 2813, 2844, 2873, 2901, 2928, 2956, 2982, 3006, 3032, 3059, 3084, 3110, 3135, 3160, 3184, 3209];

function linear(raw) {
    return Math.floor((COEFF_A * raw + 32768) / 65536) + COEFF_B;
}

function interpolate(lower, upper, step, point) {
    return Math.floor((lower * (step - point) + upper * point + step / 2) / step);
}

function fromLut(raw) {
    const i = Math.min(LUT_LOW.length - 2, Math.floor((raw - LUT_LOW_THRESH) / LUT_STEP));
    const at = (index) => interpolate(LUT_LOW[index], LUT_HIGH[index], 200, VREF - 1000);
    return interpolate(at(i), at(i + 1), LUT_STEP, raw - LUT_LOW_THRESH - i * LUT_STEP);
}

function calibrated(raw) {
    if (raw < LUT_LOW_THRESH) return linear(raw);
    const lut = fromLut(raw);
    if (raw > LUT_LOW_THRESH + LUT_STEP) return lut;
    return interpolate(linear(raw), lut, LUT_STEP, raw - LUT_LOW_THRESH);
}

function rawFor(mv) {
    let low = 0;
    let high = 4095;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (calibrated(mid) <= mv) low = mid;
        else high = mid - 1;
    }
    return low;
}

export function adcMillivolts(mv) {
    return calibrated(rawFor(mv));
}

export function analogInValue(mv) {
    return Math.floor((adcMillivolts(mv) * 65535) / 3300);
}

const LUX_DARKEST = 10 * (LDR_DARK / LDR_AT_10_LUX) ** (-1 / LDR_GAMMA);
const LUX_FLOOR = luxForMillivolts(COEFF_B);
const LUX_LOW = LUX_DARKEST * 0.8;
const LUX_HIGH = LUX_FLOOR * 1.25;
const BACKLIGHT_LEAK_LUX = luxForMillivolts(220);

function luxForMillivolts(mv) {
    let low = LUX_DARKEST;
    let high = 1e5;
    for (let i = 0; i < 60; i++) {
        const middle = Math.sqrt(low * high);
        if (millivoltsAt(middle) > mv) low = middle;
        else high = middle;
    }
    return high;
}
