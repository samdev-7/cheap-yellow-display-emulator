const ANSWER = { STATE: 0, VALUE: 1, ERROR: 2 };
const DNS_NOT_FOUND = 1000;
const ERRNO = { ECONNRESET: 104, ECONNREFUSED: 111, ETIMEDOUT: 116, EHOSTUNREACH: 118 };

const DOH = 'https://cloudflare-dns.com/dns-query';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;
const RATE_PER_MINUTE = { http: 120, dns: 120 };
const BLOCKED_TYPES = new Set([251, 252, 255]);

const FORBIDDEN = new Set(['accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method', 'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via']);

const REASONS = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };

export class NetworkBridge {
    constructor({ proxy, wake, notice, fetch: fetchImpl = globalThis.fetch.bind(globalThis) }) {
        this.proxy = proxy;
        this.wake = wake;
        this.notice = notice;
        this.fetch = fetchImpl;
        this.waiting = new Map(); // request id -> { answer, bytes }, until the worker takes the bytes.
        this.recent = {}; // 'http' | 'dns' -> times of recent requests.
    }

    handle(message) {
        switch (message.type) {
            case 'net':
                this.answer(message);
                return true;
            case 'net-body': {
                const waiting = this.waiting.get(message.id);
                this.waiting.delete(message.id);
                if (waiting) {
                    new Uint8Array(message.body).set(waiting.bytes);
                    this.settle(waiting.answer, 2);
                }
                return true;
            }
            case 'net-notice':
                this.notice(message.text);
                return true;
            default:
                return false;
        }
    }

    reset() {
        this.waiting.clear();
        this.recent = {};
    }

    async answer(message) {
        const { answer } = message;
        try {
            this.checkRate(message.op);
            if (message.op === 'dns') {
                const ip = await this.lookup(message.host);
                if (ip === null) Atomics.store(answer, ANSWER.ERROR, DNS_NOT_FOUND);
                else Atomics.store(answer, ANSWER.VALUE, ip | 0);
                this.settle(answer, 1);
                return;
            }
            const bytes = message.op === 'dns-query' ? await this.query(message.query) : await this.request(message);
            this.waiting.set(message.id, { answer, bytes });
            Atomics.store(answer, ANSWER.VALUE, bytes.length);
            this.settle(answer, 1);
        } catch (error) {
            Atomics.store(answer, ANSWER.ERROR, error.errno ?? ERRNO.ECONNRESET);
            if (error.notice) this.notice(error.notice);
            this.settle(answer, 1);
        }
    }

    settle(answer, state) {
        Atomics.store(answer, ANSWER.STATE, state);
        this.wake();
    }

    async lookup(host) {
        try {
            const response = await this.fetch(`${DOH}?name=${encodeURIComponent(host)}&type=A`, {
                headers: { Accept: 'application/dns-json' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            const reply = await response.json();
            if (reply.Status === 3) return null; // NXDOMAIN
            const record = (reply.Answer ?? []).find((entry) => entry.type === 1);
            if (record) return ipv4(record.data);
            if (reply.Status === 0) return null;
        } catch {
        }
        return madeUpAddress(host);
    }

    checkRate(op) {
        const now = Date.now();
        const kind = op === 'http' ? 'http' : 'dns';
        const times = (this.recent[kind] ??= []).filter((time) => now - time < 60_000);
        times.push(now);
        this.recent[kind] = times;
        if (times.length > RATE_PER_MINUTE[kind]) {
            throw failure(ERRNO.ECONNRESET, `Too many network ${kind === 'http' ? 'requests' : 'lookups'} from the board. Wait a minute.`);
        }
    }

    async query(bytes) {
        const flags = bytes.length >= 12 ? (bytes[2] << 8) | bytes[3] : 0;
        const questions = bytes.length >= 12 ? (bytes[4] << 8) | bytes[5] : 0;
        const isQuery = (flags & 0x8000) === 0 && ((flags >> 11) & 0xf) === 0;
        const type = questions === 1 ? questionType(bytes) : null;
        if (bytes.length > 512 || !isQuery || questions !== 1 || type === null || BLOCKED_TYPES.has(type)) {
            throw failure(ERRNO.ETIMEDOUT, 'The emulator only sends ordinary DNS questions.');
        }
        const response = await this.fetch(DOH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/dns-message', Accept: 'application/dns-message' },
            body: bytes,
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw failure(ERRNO.ETIMEDOUT);
        return new Uint8Array(await response.arrayBuffer());
    }

    async request({ method, url, headers, body, keepAlive }) {
        const target = new URL(url);
        if (isPrivateHost(target.hostname)) {
            throw failure(ERRNO.EHOSTUNREACH, `The emulator can't reach ${target.hostname}: it's on a private network.`);
        }
        const reply = this.proxy ? await this.viaProxy(method, url, headers, body) : await this.direct(method, url, headers, body);
        return toHttp(reply, method, keepAlive);
    }

    async direct(method, url, headers, body) {
        const outgoing = new Headers();
        for (const [name, value] of headers) {
            if (!FORBIDDEN.has(name.toLowerCase())) {
                try {
                    outgoing.append(name, value);
                } catch {
                }
            }
        }
        let response;
        try {
            response = await this.fetch(url, {
                method,
                headers: outgoing,
                body: method === 'GET' || method === 'HEAD' ? undefined : body,
                credentials: 'omit',
                cache: 'no-store',
                referrerPolicy: 'no-referrer',
                redirect: 'follow',
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (error) {
            if (error.name === 'TimeoutError') throw failure(ERRNO.ETIMEDOUT);
            throw error;
        }
        const bytes = await readCapped(response);
        const replyHeaders = [...response.headers].filter(([name]) => !['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name));
        return { status: response.status, statusText: response.statusText, headers: replyHeaders, body: bytes };
    }

    async viaProxy(method, url, headers, body) {
        try {
            return await this.proxy.request({ method, url, headers, body });
        } catch (error) {
            throw proxyFailure(error, new URL(url).hostname);
        }
    }
}

function toHttp({ status, statusText, headers, body }, method, keepAlive) {
    const lines = [`HTTP/1.1 ${status} ${statusText || REASONS[status] || 'Unknown'}`];
    let length = null;
    for (const [name, value] of headers) {
        const key = name.toLowerCase();
        if (key === 'connection' || key === 'transfer-encoding' || key === 'keep-alive') continue;
        if (key === 'content-length') {
            length = value;
            continue;
        }
        lines.push(`${name}: ${value}`);
    }
    lines.push(`Content-Length: ${method === 'HEAD' && length !== null ? length : body.length}`);
    if (!keepAlive) lines.push('Connection: close');
    const head = new TextEncoder().encode(`${lines.join('\r\n')}\r\n\r\n`);
    const bytes = new Uint8Array(head.length + body.length);
    bytes.set(head);
    bytes.set(body, head.length);
    return bytes;
}

async function readCapped(response) {
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array(0);
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) {
            reader.cancel();
            throw failure(ERRNO.ECONNRESET, 'The response was over 5 MB, more than the emulator takes.');
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}

function questionType(bytes) {
    let offset = 12;
    while (offset < bytes.length) {
        const length = bytes[offset];
        if (length === 0) break;
        if (length > 63) return null; // No compression pointers in a question.
        offset += length + 1;
    }
    if (offset + 5 > bytes.length) return null;
    return (bytes[offset + 1] << 8) | bytes[offset + 2];
}

function failure(errno, notice) {
    return Object.assign(new Error(notice ?? `errno ${errno}`), { errno, notice });
}

function proxyFailure(error, host) {
    switch (error.code) {
        case 'address':
            return failure(ERRNO.EHOSTUNREACH, `The emulator can't reach ${host}: it's on a private network.`);
        case 'port':
        case 'refused':
        case 'connect':
        case 'dns':
            return failure(ERRNO.ECONNREFUSED);
        case 'timeout':
            return failure(ERRNO.ETIMEDOUT);
        case 'too_large':
            return failure(ERRNO.ECONNRESET, 'The response was over 5 MB, more than the emulator takes.');
        case 'rate':
            return failure(ERRNO.ECONNRESET, 'Too many network requests through the proxy. Wait a minute.');
        default:
            return failure(ERRNO.ECONNRESET, `Network proxy: ${error.message}`);
    }
}

function isPrivateHost(host) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
    const ip = ipv4(host);
    if (ip === null) return host.includes(':'); // IPv6 literals aren't supported.
    const [a, b] = [ip >>> 24, (ip >>> 16) & 255];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128) || a >= 224;
}

function ipv4(text) {
    const parts = String(text).split('.');
    if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) < 256)) return null;
    return parts.reduce((ip, part) => ((ip << 8) | Number(part)) >>> 0, 0);
}

function madeUpAddress(host) {
    let hash = 0;
    for (const char of host) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return ((198 << 24) | (18 << 16) | (hash & 0x1ffff)) >>> 0;
}
