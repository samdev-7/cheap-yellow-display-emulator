const SETTINGS_KEY = 'cyd-wakatime';
const QUEUE_KEY = 'cyd-wakatime-queue';

export const SERVERS = [
    { id: 'wakatime', name: 'WakaTime', apiUrl: 'https://api.wakatime.com/api/v1', dashboard: 'https://wakatime.com/dashboard', keyPage: 'https://wakatime.com/settings/api-key' },
    { id: 'hackatime', name: 'Hackatime', apiUrl: 'https://hackatime.hackclub.com/api/hackatime/v1', dashboard: 'https://hackatime.hackclub.com/', keyPage: 'https://hackatime.hackclub.com/my/settings' },
];

const HEARTBEAT_EVERY_MS = 2 * 60 * 1000;
const DUPLICATE_WRITE_MS = 10 * 60 * 1000;
const PASTE_LINES = 50;
const PASTE_WITHIN_MS = 60 * 1000;
const SEND_EVERY_MS = 10 * 1000;
const BATCH = 25;
const MAX_QUEUED = 500;
const TODAY_EVERY_MS = 60 * 1000;

const VERSION = '1.0.0';
export const EDITOR = 'browser-cyd';

const API_KEY = /^(waka_)?[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function validApiKey(key) {
    return API_KEY.test(key);
}

const system = { os: 'unknown', version: 'unknown', arch: 'unknown', osName: 'Unknown OS', browser: 'Browser' };
{
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    if (/mac|iphone|ipad/i.test(platform)) Object.assign(system, { os: 'darwin', osName: 'macOS' });
    else if (/win/i.test(platform)) Object.assign(system, { os: 'windows', osName: 'Windows' });
    else if (/cros/i.test(platform)) Object.assign(system, { os: 'linux', osName: 'ChromeOS' });
    else if (/linux|android/i.test(platform)) Object.assign(system, { os: 'linux', osName: 'Linux' });
    const agent = navigator.userAgent;
    system.browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Browser';
    navigator.userAgentData
        ?.getHighEntropyValues?.(['architecture', 'bitness'])
        .then(({ architecture, bitness }) => {
            if (architecture === 'arm') system.arch = bitness === '64' ? 'arm64' : 'arm';
            else if (architecture === 'x86') system.arch = bitness === '64' ? 'x86_64' : 'i386';
        })
        .catch(() => {});
}

export function userAgent() {
    return `wakatime/v${VERSION} (${system.os}-${system.version}-${system.arch}) ${EDITOR}/${VERSION} ${EDITOR}-wakatime/${VERSION}`;
}

export function machineName() {
    return `${system.browser} on ${system.osName}`;
}

const LANGUAGES = {
    py: 'Python',
    toml: 'TOML',
    txt: 'Text',
    md: 'Markdown',
    json: 'JSON',
    html: 'HTML',
    js: 'JavaScript',
};

export function languageOf(path) {
    return LANGUAGES[path.split('.').pop().toLowerCase()];
}

export function pythonDependencies(text) {
    const found = [];
    const add = (name) => {
        const top = name.trim().split('.')[0].trim();
        if (top && top.length <= 200 && !/^(os|sys|__[a-z]+__)$/i.test(top) && !found.includes(top)) found.push(top);
    };
    for (const line of text.split('\n')) {
        const from = line.match(/^\s*from\s+([\w.]+)\s+import\b/);
        if (from) {
            add(from[1]);
            continue;
        }
        const imports = line.match(/^\s*import\s+([^#;]+)/);
        if (imports) {
            for (const part of imports[1].split(',')) {
                const words = part.trim().split(/\s+/);
                add(words[0]);
                if (words.includes('as')) break;
            }
        }
    }
    return found.slice(0, 1000);
}

export function heartbeat({ path, project, text, lineno, cursorpos, lines, isWrite, humanLineChanges, time }) {
    const folder = `/${project.replace(/\//g, '-')}`;
    const entity = `${folder}${path}`;
    const language = languageOf(path);
    const dependencies = language === 'Python' ? pythonDependencies(text) : [];
    return {
        branch: '',
        cursorpos,
        ...(dependencies.length ? { dependencies } : {}),
        entity,
        type: 'file',
        ...(humanLineChanges ? { human_line_changes: humanLineChanges } : {}),
        ...(isWrite ? { is_write: true } : {}),
        ...(language ? { language } : {}),
        lineno,
        lines,
        project,
        project_root_count: `${folder}/`.split('/').length - 1,
        time,
        user_agent: userAgent(),
    };
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
        this.last = null; // { path, time } of the last heartbeat
        this.lastWrite = new Map(); // path: { time, lineno, cursorpos } of its last save
        this.lineCounts = new Map(); // path: { lines, at } as last seen
        this.lineChanges = new Map(); // path: lines typed since the last heartbeat
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

    edited(path, lines) {
        const now = Date.now();
        const previous = this.lineCounts.get(path) ?? { lines, at: now };
        let delta = lines - previous.lines;
        if (delta > PASTE_LINES && now - previous.at < PASTE_WITHIN_MS) delta = 0;
        this.lineChanges.set(path, (this.lineChanges.get(path) ?? 0) + delta);
        this.lineCounts.set(path, { lines, at: now });
    }

    activity({ path, project, text, lineno, cursorpos, lines, isWrite = false }) {
        if (!this.lineCounts.has(path)) this.lineCounts.set(path, { lines, at: Date.now() });
        if (!this.active) return;
        const now = Date.now();
        const due = !this.last || this.last.path !== path || now - this.last.time >= HEARTBEAT_EVERY_MS;
        if (!due && !isWrite) return;
        if (isWrite) {
            const previous = this.lastWrite.get(path);
            const duplicate = previous && now - previous.time < DUPLICATE_WRITE_MS && previous.lineno === lineno && previous.cursorpos === cursorpos;
            this.lastWrite.set(path, { time: now, lineno, cursorpos });
            if (duplicate) return;
        }
        this.last = { path, time: now };
        this.queue.push(heartbeat({ path, project, text, lineno, cursorpos, lines, isWrite, humanLineChanges: this.lineChanges.get(path), time: now / 1000 }));
        this.lineChanges.clear();
        if (this.queue.length > MAX_QUEUED) this.queue.splice(0, this.queue.length - MAX_QUEUED);
        writeJson(QUEUE_KEY, this.queue);
    }

    request(path, options = {}) {
        const extra = this.server?.id === 'wakatime' ? { Timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, 'X-Machine-Name': machineName() } : {};
        return fetch(`${this.settings.apiUrl}${path}`, {
            ...options,
            headers: {
                Accept: 'application/json',
                Authorization: `Basic ${btoa(this.settings.apiKey)}`,
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...extra,
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
            const body = this.server?.id === 'hackatime' ? batch.map((beat) => ({ ...beat, machine: machineName() })) : batch;
            const response = await this.request('/users/current/heartbeats.bulk', { method: 'POST', body: JSON.stringify(body), keepalive });
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
                headers: { Accept: 'application/json', Authorization: `Basic ${btoa(apiKey)}` },
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
