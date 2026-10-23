const SETTINGS_KEY = 'cyd-wakatime';
const QUEUE_KEY = 'cyd-wakatime-queue';

export const SERVERS = [
    { id: 'wakatime', name: 'WakaTime', apiUrl: 'https://api.wakatime.com/api/v1', dashboard: 'https://wakatime.com/dashboard', keyPage: 'https://wakatime.com/settings/api-key' },
    { id: 'hackatime', name: 'Hackatime', apiUrl: 'https://hackatime.hackclub.com/api/hackatime/v1', dashboard: 'https://hackatime.hackclub.com/', keyPage: 'https://hackatime.hackclub.com/my/settings' },
];

const HEARTBEAT_EVERY_MS = 2 * 60 * 1000;
const SEND_EVERY_MS = 10 * 1000;
const BATCH = 25;
const MAX_QUEUED = 500;
const TODAY_EVERY_MS = 60 * 1000;

const VERSION = '1.0.0';

function userAgent() {
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    const os = /mac/i.test(platform) ? 'darwin' : /win/i.test(platform) ? 'windows' : /linux|cros/i.test(platform) ? 'linux' : 'unknown';
    return `wakatime/v${VERSION} (${os}-browser) browser cyd-editor/${VERSION} cyd-wakatime/${VERSION}`;
}

const LANGUAGES = {
    py: 'Python',
    toml: 'TOML',
    txt: 'Text',
    md: 'Markdown',
    json: 'JSON',
    csv: 'CSV',
    html: 'HTML',
    js: 'JavaScript',
};

export function languageOf(path) {
    return LANGUAGES[path.split('.').pop().toLowerCase()];
}

export function normaliseApiUrl(text) {
    let url;
    try {
        url = new URL(text.trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const path = url.pathname.replace(/\/+$/, '').replace(/\/users\/current(\/.*)?$/, '');
    return `${url.origin}${path}`;
}

function readJson(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
    }
}

export class WakaTime extends EventTarget {
    constructor() {
        super();
        this.settings = { enabled: true, apiKey: '', apiUrl: SERVERS[0].apiUrl, ...readJson(SETTINGS_KEY, {}) };
        this.queue = readJson(QUEUE_KEY, []);
        this.last = null; // { entity, time } of the last heartbeat
        this.today = null; // today's total as text, like "1 hr 5 mins"
        this.todayAt = 0;
        this.error = null; // why the last request failed, or null
        this.sending = false;
        setInterval(() => this.send(), SEND_EVERY_MS);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.send(true);
        });
        if (this.active) this.refreshToday();
    }

    get active() {
        return this.settings.enabled && Boolean(this.settings.apiKey);
    }

    get server() {
        return SERVERS.find((server) => server.apiUrl === this.settings.apiUrl) ?? null;
    }

    get dashboard() {
        return this.server?.dashboard ?? new URL(this.settings.apiUrl).origin;
    }

    configure(changes) {
        const switched = (changes.apiUrl && changes.apiUrl !== this.settings.apiUrl) || (changes.apiKey !== undefined && changes.apiKey !== this.settings.apiKey);
        this.settings = { ...this.settings, ...changes };
        writeJson(SETTINGS_KEY, this.settings);
        if (switched) {
            this.today = null;
            this.error = null;
        }
        this.changed();
        if (this.active) {
            this.refreshToday(true);
            this.send();
        }
    }

    changed() {
        this.dispatchEvent(new Event('change'));
    }

    activity({ entity, project, lineno, cursorpos, lines, isWrite = false }) {
        if (!this.active) return;
        const now = Date.now();
        const due = !this.last || this.last.entity !== entity || now - this.last.time >= HEARTBEAT_EVERY_MS;
        if (!due && !isWrite) return;
        this.last = { entity, time: now };
        this.queue.push({
            entity,
            type: 'file',
            category: 'coding',
            time: now / 1000,
            project,
            language: languageOf(entity),
            lineno,
            cursorpos,
            lines,
            is_write: isWrite,
            user_agent: userAgent(),
        });
        if (this.queue.length > MAX_QUEUED) this.queue.splice(0, this.queue.length - MAX_QUEUED);
        writeJson(QUEUE_KEY, this.queue);
    }

    request(path, options = {}) {
        return fetch(`${this.settings.apiUrl}${path}`, {
            ...options,
            headers: {
                Authorization: `Basic ${btoa(this.settings.apiKey)}`,
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            },
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            cache: 'no-store',
        });
    }

    async send(keepalive = false) {
        if (!this.active || this.sending || this.queue.length === 0 || !navigator.onLine) return;
        this.sending = true;
        const batch = this.queue.slice(0, BATCH);
        try {
            const response = await this.request('/users/current/heartbeats.bulk', { method: 'POST', body: JSON.stringify(batch), keepalive });
            if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403 && response.status !== 429)) {
                this.queue.splice(0, batch.length);
                writeJson(QUEUE_KEY, this.queue);
                this.setError(response.ok ? null : `The server turned down some activity (${response.status})`);
            } else {
                this.setError(failure(response.status));
            }
        } catch {
            this.setError("Can't reach the server");
        } finally {
            this.sending = false;
        }
        if (this.queue.length >= BATCH) {
            this.send();
        } else {
            this.refreshToday();
        }
    }

    async refreshToday(now = false) {
        if (!this.active || (!now && Date.now() - this.todayAt < TODAY_EVERY_MS)) return;
        this.todayAt = Date.now();
        try {
            const response = await this.request('/users/current/statusbar/today');
            if (!response.ok) {
                this.setError(failure(response.status));
                return;
            }
            const { data } = await response.json();
            this.today = data?.grand_total?.text || '0 secs';
            this.setError(null);
        } catch {
            this.setError("Can't reach the server");
        }
    }

    setError(error) {
        this.error = error;
        this.changed();
    }

    static async check(apiUrl, apiKey) {
        try {
            const response = await fetch(`${apiUrl}/users/current/statusbar/today`, {
                headers: { Authorization: `Basic ${btoa(apiKey)}` },
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                cache: 'no-store',
            });
            return response.ok ? null : failure(response.status);
        } catch {
            return "Can't reach that server. Check the URL. The server must allow requests from web pages (CORS), and this site must allow the server (connect-src in vercel.json).";
        }
    }
}

function failure(status) {
    if (status === 401 || status === 403) return 'The API key was turned down';
    if (status === 404) return "That server doesn't have the WakaTime API at this URL";
    if (status === 429) return 'The server asked to slow down; trying again soon';
    return `The server had a problem (${status})`;
}
