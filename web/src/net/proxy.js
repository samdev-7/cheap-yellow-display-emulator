const TEST_SITE_KEY = '1x00000000000000000000AA'; // Cloudflare's always-pass test key.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || (import.meta.env.DEV ? TEST_SITE_KEY : '');
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const REFRESH_MARGIN_MS = 30_000;
const KEEP_WARM_MS = 5 * 60_000;

export class ProxyError extends Error {
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

export class NetworkProxy {
    constructor() {
        this.access = null; // { token, expiresAt }
        this.pending = null; // The token being fetched, shared by everyone waiting.
        this.refreshTimer = 0;
        this.lastUsed = 0;
    }

    async request({ method, url, headers = [], body = null }) {
        this.lastUsed = Date.now();
        const meta = base64url(JSON.stringify({ method, url, headers }));
        const send = async (token) =>
            fetch('/api/proxy', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'X-Proxy-Request': meta },
                body: body ?? new Uint8Array(),
            });
        let response = await send(await this.token());
        if (response.status === 401) {
            this.access = null;
            response = await send(await this.token());
        }
        const header = response.headers.get('x-proxy-response');
        if (!response.ok || !header) {
            const problem = await response.json().catch(() => ({}));
            throw new ProxyError(problem.error || 'proxy', problem.message || `Proxy error ${response.status}`, response.status);
        }
        const { status, statusText, headers: replyHeaders } = JSON.parse(fromBase64url(header));
        return { status, statusText, headers: replyHeaders, body: new Uint8Array(await response.arrayBuffer()) };
    }

    token() {
        if (this.access && this.access.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
            return Promise.resolve(this.access.token);
        }
        this.pending ??= this.fetchToken().finally(() => {
            this.pending = null;
        });
        return this.pending;
    }

    async fetchToken() {
        let response = await post('/api/token');
        if (response.status === 401) {
            await this.startSession();
            response = await post('/api/token');
        }
        const reply = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new ProxyError(reply.error || 'token', reply.message || `Couldn't get a proxy token (${response.status}).`, response.status);
        }
        this.access = { token: reply.token, expiresAt: reply.expiresAt };
        this.scheduleRefresh();
        return reply.token;
    }

    scheduleRefresh() {
        clearTimeout(this.refreshTimer);
        const wait = Math.max(0, this.access.expiresAt - Date.now() - REFRESH_MARGIN_MS);
        this.refreshTimer = setTimeout(() => {
            if (Date.now() - this.lastUsed < KEEP_WARM_MS) {
                this.access = null;
                this.token().catch(() => {});
            }
        }, wait);
    }

    async startSession() {
        const turnstile = await runTurnstile();
        const response = await post('/api/session', { turnstile });
        if (!response.ok) {
            const reply = await response.json().catch(() => ({}));
            throw new ProxyError(reply.error || 'session', reply.message || `Couldn't start a proxy session (${response.status}).`, response.status);
        }
    }
}

function post(path, body) {
    return fetch(path, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
    });
}

let turnstileLoaded = null;
function loadTurnstile() {
    turnstileLoaded ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT;
        script.async = true;
        script.onload = () => resolve(window.turnstile);
        script.onerror = () => {
            turnstileLoaded = null;
            reject(new ProxyError('turnstile', "Couldn't load the Turnstile check."));
        };
        document.head.append(script);
    });
    return turnstileLoaded;
}

async function runTurnstile() {
    if (!SITE_KEY) {
        throw new ProxyError('not_configured', 'The network proxy has no Turnstile site key (VITE_TURNSTILE_SITE_KEY).');
    }
    const turnstile = await loadTurnstile();
    const box = document.createElement('div');
    box.className = 'turnstile';
    document.body.append(box);
    try {
        return await new Promise((resolve, reject) => {
            turnstile.render(box, {
                sitekey: SITE_KEY,
                action: 'network',
                appearance: 'interaction-only',
                callback: resolve,
                'error-callback': (code) => reject(new ProxyError('turnstile', `The Turnstile check failed (${code}).`)),
                'expired-callback': () => reject(new ProxyError('turnstile', 'The Turnstile check expired.')),
            });
        });
    } finally {
        box.remove();
    }
}

function base64url(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text) {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}
