import { addressHash } from './tokens.js';

export const TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

export function config(env) {
    const dev = Boolean(env.dev);
    return {
        dev,
        enabled: env.PROXY_ENABLED !== 'false',
        secret: env.PROXY_SECRET || (dev ? devSecret : ''),
        turnstileSecret: env.TURNSTILE_SECRET_KEY || (dev ? TEST_SECRET_KEY : ''),
        turnstileHostnames: (env.TURNSTILE_HOSTNAMES || '')
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter(Boolean),
    };
}

const devSecret = `dev-${Math.random()}`;

export function json(status, body, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
    });
}

export function error(status, code, message) {
    return json(status, { error: code, message });
}

export function refuse(request, settings) {
    if (!settings.enabled) {
        return error(503, 'disabled', 'The network proxy is switched off.');
    }
    if (!settings.secret || !settings.turnstileSecret) {
        return error(500, 'not_configured', 'The network proxy is missing PROXY_SECRET or TURNSTILE_SECRET_KEY.');
    }
    if (request.method !== 'POST') {
        return error(405, 'method', 'Use POST.');
    }
    if (!sameOrigin(request)) {
        return error(403, 'origin', 'Only the editor on this site can use the network proxy.');
    }
    return null;
}

// Browsers set Sec-Fetch-Site and Origin; pages can't change them.
export function sameOrigin(request) {
    const site = request.headers.get('sec-fetch-site');
    if (site) return site === 'same-origin';
    const origin = request.headers.get('origin');
    if (!origin) return false;
    return new URL(origin).host === new URL(request.url).host;
}

export function readCookie(request, name) {
    for (const part of (request.headers.get('cookie') || '').split(';')) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) return value.join('=');
    }
    return null;
}

export function cookie(name, value, { path, maxAge, dev, sameSite = 'Lax' }) {
    return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSite}${dev ? '' : '; Secure'}`;
}

export function clientAddress(request) {
    const forwarded = request.headers.get('x-forwarded-for');
    return forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'local';
}

export function clientHash(request, settings) {
    return addressHash(clientAddress(request), settings.secret);
}
