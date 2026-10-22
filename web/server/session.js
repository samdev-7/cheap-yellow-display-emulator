import { TEST_SECRET_KEY, clientAddress, clientHash, config, error, json, refuse } from './guard.js';
import { ACCESS_SECONDS, SESSION_SECONDS, newId, sign, verify } from './tokens.js';

export const SESSION_COOKIE = 'cyd_session';
const TURNSTILE_ACTION = 'network';

export async function handleSession(request, env) {
    const settings = config(env);
    const refused = refuse(request, settings);
    if (refused) return refused;

    const { turnstile } = await request.json().catch(() => ({}));
    if (typeof turnstile !== 'string' || !turnstile || turnstile.length > 2048) {
        return error(400, 'turnstile', 'Missing the Turnstile token.');
    }
    if (!settings.dev && settings.turnstileHostnames.length === 0) {
        return error(500, 'not_configured', 'The network proxy is missing TURNSTILE_HOSTNAMES.');
    }
    const form = new URLSearchParams({ secret: settings.turnstileSecret, response: turnstile });
    const address = clientAddress(request);
    if (address !== 'local') form.set('remoteip', address);
    const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(10_000),
    })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
    if (!check || check.success !== true || !passes(check, settings)) {
        return error(403, 'turnstile', 'The Turnstile check failed.');
    }

    const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const session = sign({ kind: 'session', sid: newId(), ip: clientHash(request, settings), exp }, settings.secret);
    const secure = settings.dev ? '' : '; Secure';
    return json(200, { expiresAt: exp * 1000 }, {
        'Set-Cookie': `${SESSION_COOKIE}=${session}; Path=/api; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Strict${secure}`,
    });
}

function passes(check, settings) {
    if (settings.turnstileSecret === TEST_SECRET_KEY) return settings.dev;
    if (check.action !== TURNSTILE_ACTION) return false;
    return settings.turnstileHostnames.length === 0 ? settings.dev : settings.turnstileHostnames.includes(check.hostname);
}

export async function handleToken(request, env) {
    const settings = config(env);
    const refused = refuse(request, settings);
    if (refused) return refused;

    const session = verify(readCookie(request, SESSION_COOKIE), 'session', settings.secret);
    if (!session || session.ip !== clientHash(request, settings)) {
        return error(401, 'session', 'No session, or it has expired.');
    }
    const exp = Math.min(session.exp, Math.floor(Date.now() / 1000) + ACCESS_SECONDS);
    const token = sign({ kind: 'access', sid: session.sid, ip: session.ip, exp }, settings.secret);
    return json(200, { token, expiresAt: exp * 1000, sessionExpiresAt: session.exp * 1000 });
}

function readCookie(request, name) {
    for (const part of (request.headers.get('cookie') || '').split(';')) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) return value.join('=');
    }
    return null;
}
