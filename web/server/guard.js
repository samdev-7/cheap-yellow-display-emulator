import { addressHash } from './tokens.js';

export const TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

export function config(env) {
    const dev = Boolean(env.dev);
    return {
        dev,
        enabled: env.PROXY_ENABLED !== 'false',
        secret: env.PROXY_SECRET || (dev ? devSecret : ''),
        turnstileSecret: env.TURNSTILE_SECRET_KEY || (dev ? TEST_SECRET_KEY : ''),
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

function sameOrigin(request) {
    const site = request.headers.get('sec-fetch-site');
    if (site) return site === 'same-origin';
    const origin = request.headers.get('origin');
    if (!origin) return false;
    return new URL(origin).host === new URL(request.url).host;
}

export function clientAddress(request) {
    const forwarded = request.headers.get('x-forwarded-for');
    return forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'local';
}

export function clientHash(request, settings) {
    return addressHash(clientAddress(request), settings.secret);
}
