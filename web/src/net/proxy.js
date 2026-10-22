const TEST_SITE_KEY = '1x00000000000000000000AA'; // Cloudflare's always-pass test key.
const env = import.meta.env ?? {}; // Undefined outside Vite, as in tests.
const SITE_KEY = env.VITE_TURNSTILE_SITE_KEY || (env.DEV ? TEST_SITE_KEY : '');
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TIMING = {
    refreshMarginMs: 30_000, // Get a new token this long before the current one ends.
    sessionMarginMs: 2 * 60_000, // Renew the session this long before it ends.
    keepWarmMs: 5 * 60_000, // Keep refreshing for this long after the proxy was last used.
    retryMs: 15_000, // After a background refresh fails, try again this soon.
};

export class ProxyError extends Error {
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

export class NetworkProxy {
    constructor({ fetch: fetchImpl, turnstile = runTurnstile, ...timing } = {}) {
        this.fetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
        this.turnstile = turnstile;
        this.timing = { ...TIMING, ...timing };
        this.access = null; // { token, expiresAt } on this page's clock.
        this.sessionExpiresAt = 0; // On this page's clock; 0 when unknown.
        this.pending = null; // The refresh under way, shared by everyone waiting.
        this.refreshTimer = 0;
        this.lastUsed = 0;
    }

    async request({ method, url, headers = [], body = null }) {
        this.lastUsed = Date.now();
        const meta = base64url(JSON.stringify({ method, url, headers }));
        const send = async (token) =>
            this.fetch('/api/proxy', {
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
        if (this.access && this.access.expiresAt - Date.now() > this.timing.refreshMarginMs) {
            return Promise.resolve(this.access.token);
        }
        return this.refresh();
    }

    refresh() {
        this.pending ??= this.fetchToken().finally(() => {
            this.pending = null;
        });
        return this.pending;
    }

    async fetchToken() {
        if (this.sessionExpiresAt && this.sessionExpiresAt - Date.now() < this.timing.sessionMarginMs) {
            await this.startSession();
        }
        let response = await this.post('/api/token');
        if (response.status === 401) {
            await this.startSession();
            response = await this.post('/api/token');
        }
        const reply = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new ProxyError(reply.error || 'token', reply.message || `Couldn't get a proxy token (${response.status}).`, response.status);
        }
        const received = Date.now();
        this.access = { token: reply.token, expiresAt: received + reply.expiresIn * 1000 };
        this.sessionExpiresAt = received + reply.sessionExpiresIn * 1000;
        this.scheduleRefresh(this.access.expiresAt - received - this.timing.refreshMarginMs);
        return reply.token;
    }

    scheduleRefresh(wait) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
            if (Date.now() - this.lastUsed > this.timing.keepWarmMs) return;
            this.refresh().catch(() => this.scheduleRefresh(this.timing.retryMs));
        }, Math.max(1000, wait));
    }

    async startSession() {
        const turnstile = await this.turnstile();
        const response = await this.post('/api/session', { turnstile });
        const reply = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new ProxyError(reply.error || 'session', reply.message || `Couldn't start a proxy session (${response.status}).`, response.status);
        }
        this.sessionExpiresAt = Date.now() + reply.expiresIn * 1000;
    }

    post(path, body) {
        return this.fetch(path, {
            method: 'POST',
            headers: body ? { 'Content-Type': 'application/json' } : {},
            body: body ? JSON.stringify(body) : undefined,
            credentials: 'same-origin',
        });
    }
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
