import { CTRL } from './shared.js';

// newlib's errno values, which CircuitPython on the ESP32 reports.
export const ERRNO = {
    EBADF: 9,
    EAGAIN: 11,
    ENOMEM: 12,
    EINVAL: 22,
    ECONNRESET: 104,
    ECONNREFUSED: 111,
    ECONNABORTED: 113,
    ETIMEDOUT: 116,
    EHOSTUNREACH: 118,
    EINPROGRESS: 119,
    EISCONN: 127,
    ENOTCONN: 128,
};
export const DNS_NOT_FOUND = 1000;

export const ANSWER = {
    STATE: 0,
    VALUE: 1,
    ERROR: 2,
};

export const WIFI_MODE = {
    NO_NETWORKS: 1,
    WRONG_PASSWORD: 2,
    NO_INTERNET: 4,
    REAL_TIMING: 8,
};

const TIMING = {
    join: [1800, 3500],
    scan: [1500, 2800],
    ping: [5, 50],
    lookup: [10, 60],
    ntp: [20, 80],
};
const DELAY_KINDS = ['join', 'scan', 'ping'];

const NEIGHBOURS = [
    { ssid: 'Neighbours 2.4G', rssi: -71, channel: 1, authmode: 'wpa2' },
    { ssid: 'Coffee Shop Guest', rssi: -78, channel: 6, authmode: 'open' },
    { ssid: 'DIRECT-7F-Printer', rssi: -83, channel: 11, authmode: 'wpa2' },
];

const NTP_PORT = 123;
const DNS_PORT = 53;
const NTP_EPOCH_OFFSET = 2208988800;

export class Network {
    constructor(ctrl, post) {
        this.ctrl = ctrl;
        this.post = post;
        this.sockets = new Map();
        this.nextSocket = 1;
        this.nextRequest = 1;
        this.lookups = new Map();
        this.cacheWaits = new Map();
        this.addresses = new Map();
        this.hosts = new Map();
        this.home = '';
        this.connected = false;
        this.ssid = '';
        this.dropGeneration = Atomics.load(ctrl, CTRL.WIFI_DROP);
    }

    reset() {
        for (const socket of this.sockets.values()) {
            socket.closed = true;
        }
        this.sockets.clear();
    }

    mode(bit) {
        return (Atomics.load(this.ctrl, CTRL.WIFI_MODE) & bit) !== 0;
    }

    checkDropped() {
        const generation = Atomics.load(this.ctrl, CTRL.WIFI_DROP);
        if (generation !== this.dropGeneration) {
            this.dropGeneration = generation;
            if (this.connected) {
                this.connected = false;
                for (const socket of this.sockets.values()) {
                    socket.error ||= ERRNO.ECONNABORTED;
                }
            }
        }
        if (this.connected && this.mode(WIFI_MODE.NO_NETWORKS)) {
            this.connected = false;
        }
    }

    setHome(ssid) {
        this.home = ssid;
    }

    scan() {
        if (this.mode(WIFI_MODE.NO_NETWORKS)) return [];
        const found = [...NEIGHBOURS];
        if (this.home) {
            found.unshift({ ssid: this.home, rssi: -48, channel: 6, authmode: 'wpa2' });
        }
        return found;
    }

    join(ssid) {
        this.checkDropped();
        if (this.mode(WIFI_MODE.NO_NETWORKS)) return 201;
        if (this.mode(WIFI_MODE.WRONG_PASSWORD)) return 202;
        this.connected = true;
        this.ssid = ssid;
        return 0;
    }

    delay(kind) {
        if (!this.mode(WIFI_MODE.REAL_TIMING)) return 0;
        const [low, high] = TIMING[typeof kind === 'number' ? DELAY_KINDS[kind] : kind] ?? [0, 0];
        return Math.round(low + Math.random() * (high - low));
    }

    leave() {
        this.connected = false;
    }

    isConnected() {
        this.checkDropped();
        return this.connected;
    }

    accessPoint() {
        const known = this.scan().find((network) => network.ssid === this.ssid);
        return known ?? { ssid: this.ssid, rssi: -52, channel: 6, authmode: 'wpa2' };
    }

    lookup(host) {
        this.checkDropped();
        const literal = parseIPv4(host);
        if (literal !== null) return { result: 0, ip: literal };
        if (!this.connected || this.mode(WIFI_MODE.NO_INTERNET)) return { result: DNS_NOT_FOUND };
        const name = host.toLowerCase();
        const cached = this.addresses.get(name);
        if (cached && cached.expires > Date.now()) {
            const waiting = this.cacheWaits.get(name) ?? Date.now() + this.delay('lookup');
            if (Date.now() < waiting) {
                this.cacheWaits.set(name, waiting);
                return { result: -ERRNO.EINPROGRESS };
            }
            this.cacheWaits.delete(name);
            return { result: 0, ip: cached.ip };
        }

        let pending = this.lookups.get(name);
        if (!pending) {
            pending = { answer: this.ask({ op: 'dns', host: name }) };
            this.lookups.set(name, pending);
            return { result: -ERRNO.EINPROGRESS };
        }
        const answer = pending.answer;
        if (Atomics.load(answer, ANSWER.STATE) === 0) return { result: -ERRNO.EINPROGRESS };
        this.lookups.delete(name);
        if (Atomics.load(answer, ANSWER.ERROR)) return { result: DNS_NOT_FOUND };
        const ip = Atomics.load(answer, ANSWER.VALUE) >>> 0;
        this.addresses.set(name, { ip, expires: Date.now() + 5 * 60_000 });
        this.hosts.set(ip, name);
        return { result: 0, ip };
    }

    socket(udp) {
        const id = this.nextSocket++;
        this.sockets.set(id, {
            id,
            udp,
            connected: false,
            closed: false,
            host: '',
            port: 0,
            tls: false,
            sni: '',
            out: new Uint8Array(0),
            requests: [],
            inbox: [],
            keepAlive: true,
            error: 0,
        });
        return id;
    }

    setTls(id, hostname) {
        const socket = this.sockets.get(id);
        if (!socket) return -ERRNO.EBADF;
        socket.tls = true;
        socket.sni = hostname;
        return 0;
    }

    connect(id, ip, port) {
        this.checkDropped();
        const socket = this.sockets.get(id);
        if (!socket || socket.closed) return -ERRNO.EBADF;
        if (socket.connected) return -ERRNO.EISCONN;
        if (!this.connected) return -ERRNO.EHOSTUNREACH;
        socket.host = this.hosts.get(ip) ?? formatIPv4(ip);
        socket.ip = ip;
        socket.port = port;
        if (!socket.udp) {
            if (port !== 80 && port !== 443) {
                this.notice(`The emulator only connects to web servers (ports 80 and 443), not port ${port}.`);
                return -ERRNO.ECONNREFUSED;
            }
            if (this.mode(WIFI_MODE.NO_INTERNET)) {
                socket.blackhole = true;
            }
        }
        socket.connected = true;
        return 0;
    }

    send(id, bytes) {
        this.checkDropped();
        const socket = this.sockets.get(id);
        if (!socket || socket.closed) return -ERRNO.EBADF;
        if (socket.error) return -socket.error;
        if (!socket.connected) return -ERRNO.ENOTCONN;
        socket.out = concat(socket.out, bytes);
        const problem = this.takeRequests(socket);
        return problem ? -problem : bytes.length;
    }

    takeRequests(socket) {
        for (;;) {
            const request = parseRequest(socket.out);
            if (request === null) return 0;
            if (request.error) {
                this.notice(request.error);
                return ERRNO.ECONNRESET;
            }
            socket.out = socket.out.slice(request.length);
            socket.keepAlive = request.keepAlive;
            const host = (request.host || socket.sni || socket.host).replace(/:\d+$/, '');
            const scheme = socket.tls ? 'https' : 'http';
            const port = socket.port === (socket.tls ? 443 : 80) ? '' : `:${socket.port}`;
            const target = request.target.startsWith('/') ? request.target : new URL(request.target).pathname;
            const message = {
                op: 'http',
                method: request.method,
                url: `${scheme}://${host}${port}${target}`,
                headers: request.headers,
                body: request.body,
                keepAlive: request.keepAlive,
            };
            socket.requests.push(socket.blackhole ? { blackhole: true } : { answer: this.ask(message) });
        }
    }

    recv(id, length) {
        this.checkDropped();
        const socket = this.sockets.get(id);
        if (!socket || socket.closed) return { result: -ERRNO.EBADF };
        if (socket.udp) return this.recvDatagram(socket, length);
        if (!socket.connected) return { result: -ERRNO.ENOTCONN };

        if (socket.inbox.length === 0 && socket.requests.length > 0) {
            const outcome = this.collect(socket, socket.requests[0]);
            if (outcome !== 0) return { result: outcome };
            socket.requests.shift();
        }
        if (socket.inbox.length > 0) {
            const chunk = socket.inbox[0];
            const bytes = chunk.subarray(0, length);
            if (bytes.length === chunk.length) socket.inbox.shift();
            else socket.inbox[0] = chunk.subarray(bytes.length);
            return { result: bytes.length, bytes };
        }
        if (socket.error) return { result: -socket.error };
        if (socket.done && !socket.keepAlive) return { result: 0 };
        return { result: -ERRNO.EAGAIN };
    }

    collect(socket, request) {
        if (request.blackhole) return -ERRNO.EAGAIN;
        const answer = request.answer;
        const state = Atomics.load(answer, ANSWER.STATE);
        if (state === 0) return -ERRNO.EAGAIN;
        const error = Atomics.load(answer, ANSWER.ERROR);
        if (error) {
            socket.requests = [];
            socket.error = error;
            return -error;
        }
        if (state === 1) {
            this.askForBody(request);
            return -ERRNO.EAGAIN;
        }
        socket.inbox.push(new Uint8Array(request.body).slice());
        socket.done = socket.requests.length === 1;
        return 0;
    }

    sendto(id, ip, port, bytes) {
        this.checkDropped();
        const socket = this.sockets.get(id);
        if (!socket || socket.closed) return -ERRNO.EBADF;
        if (!this.connected) return -ERRNO.EHOSTUNREACH;
        if (!this.mode(WIFI_MODE.NO_INTERNET)) {
            if (port === NTP_PORT && bytes.length >= 48) {
                socket.inbox.push({ from: ip, port, data: ntpReply(bytes), readyAt: Date.now() + this.delay('ntp') });
            } else if (port === DNS_PORT && bytes.length >= 12) {
                socket.requests.push({ answer: this.ask({ op: 'dns-query', query: bytes }), from: ip, port });
            }
        }
        return bytes.length;
    }

    recvDatagram(socket, length) {
        for (const request of [...socket.requests]) {
            const answer = request.answer;
            const state = Atomics.load(answer, ANSWER.STATE);
            if (state === 1 && !Atomics.load(answer, ANSWER.ERROR)) {
                this.askForBody(request);
            } else if (state === 2 || (state === 1 && Atomics.load(answer, ANSWER.ERROR))) {
                socket.requests.splice(socket.requests.indexOf(request), 1);
                if (state === 2) socket.inbox.push({ from: request.from, port: request.port, data: new Uint8Array(request.body).slice() });
            }
        }
        const datagram = socket.inbox[0];
        if (!datagram || (datagram.readyAt && Date.now() < datagram.readyAt)) return { result: -ERRNO.EAGAIN };
        socket.inbox.shift();
        const bytes = datagram.data.subarray(0, length);
        return { result: bytes.length, bytes, from: datagram.from, port: datagram.port };
    }

    askForBody(request) {
        if (request.body) return;
        request.body = new SharedArrayBuffer(Atomics.load(request.answer, ANSWER.VALUE));
        this.post({ type: 'net-body', id: request.answer.id, body: request.body });
    }

    readable(id) {
        const socket = this.sockets.get(id);
        if (!socket) return false;
        if (socket.inbox.length > 0 || socket.error) return true;
        const request = socket.requests[0];
        return Boolean(request?.answer && Atomics.load(request.answer, ANSWER.STATE) !== 0);
    }

    close(id) {
        const socket = this.sockets.get(id);
        if (socket) socket.closed = true;
        this.sockets.delete(id);
    }

    ask(message) {
        const answer = new Int32Array(new SharedArrayBuffer(16));
        const id = this.nextRequest++;
        answer.id = id;
        this.post({ type: 'net', id, answer, ...message });
        return answer;
    }

    notice(text) {
        this.post({ type: 'net-notice', text });
    }
}

const decoder = new TextDecoder('latin1');

function parseRequest(bytes) {
    const end = indexOf(bytes, [13, 10, 13, 10]);
    if (end < 0) {
        return bytes.length > 64 * 1024 ? { error: 'The HTTP request headers are too long.' } : null;
    }
    const lines = decoder.decode(bytes.subarray(0, end)).split('\r\n');
    const [method, target, version] = lines[0].split(' ');
    if (!method || !target || !/^HTTP\/1\.[01]$/.test(version ?? '')) {
        return { error: "The emulator's network only carries HTTP, and this isn't an HTTP request." };
    }
    const headers = [];
    let host = '';
    let length = 0;
    let connection = '';
    for (const line of lines.slice(1)) {
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        const name = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        const key = name.toLowerCase();
        if (key === 'host') host = value;
        else if (key === 'content-length') length = Number(value) || 0;
        else if (key === 'connection') connection = value.toLowerCase();
        else if (key === 'transfer-encoding') {
            return { error: "The emulator can't send chunked request bodies; send a Content-Length." };
        } else headers.push([name, value]);
    }
    const bodyStart = end + 4;
    if (bytes.length < bodyStart + length) return null;
    return {
        method,
        target,
        host,
        headers,
        body: bytes.slice(bodyStart, bodyStart + length),
        keepAlive: version === 'HTTP/1.1' ? connection !== 'close' : connection === 'keep-alive',
        length: bodyStart + length,
    };
}

function ntpReply(request) {
    const reply = new Uint8Array(48);
    const view = new DataView(reply.buffer);
    reply[0] = 0x24;
    reply[1] = 2;
    reply[2] = request[2];
    reply[3] = 0xec;
    reply.set(request.subarray(40, 48), 24);
    const now = Date.now();
    const seconds = Math.floor(now / 1000) + NTP_EPOCH_OFFSET;
    const fraction = Math.floor(((now % 1000) / 1000) * 2 ** 32);
    for (const offset of [16, 32, 40]) {
        view.setUint32(offset, seconds >>> 0);
        view.setUint32(offset + 4, fraction >>> 0);
    }
    return reply;
}

export function parseIPv4(text) {
    const parts = text.split('.');
    if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) < 256)) return null;
    return parts.reduce((ip, part) => ((ip << 8) | Number(part)) >>> 0, 0);
}

export function formatIPv4(ip) {
    return [24, 16, 8, 0].map((shift) => (ip >>> shift) & 255).join('.');
}

export function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}

function indexOf(bytes, pattern) {
    outer: for (let i = 0; i + pattern.length <= bytes.length; i++) {
        for (let j = 0; j < pattern.length; j++) {
            if (bytes[i + j] !== pattern[j]) continue outer;
        }
        return i;
    }
    return -1;
}
