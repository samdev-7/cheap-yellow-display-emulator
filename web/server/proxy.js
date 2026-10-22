import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

import { clientHash, config, error, refuse } from './guard.js';
import { verify } from './tokens.js';

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const RATE_PER_MINUTE = 120;

const DROP_REQUEST = new Set(['host', 'connection', 'keep-alive', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length', 'expect']);
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-connection', 'trailer', 'transfer-encoding', 'upgrade']);

const blocked = new net.BlockList();
for (const [address, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) {
    blocked.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
    ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
    ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) {
    blocked.addSubnet(address, prefix, 'ipv6');
}

export function isBlockedAddress(address) {
    const family = net.isIP(address);
    if (family === 0) return true;
    return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function safeLookup(hostname, options, callback) {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err);
        const bad = addresses.find(({ address }) => isBlockedAddress(address));
        if (bad || addresses.length === 0) {
            const refused = new Error(`${hostname} resolves to a private or reserved address`);
            refused.code = 'EBLOCKED';
            return callback(refused);
        }
        if (options.all) return callback(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
    });
}

const recent = new Map();
function overRate(sid) {
    const now = Date.now();
    const times = (recent.get(sid) || []).filter((t) => now - t < 60_000);
    times.push(now);
    recent.set(sid, times);
    if (recent.size > 10_000) recent.clear();
    return times.length > RATE_PER_MINUTE;
}

export async function handleProxy(request, env) {
    const settings = config(env);
    const refused = refuse(request, settings);
    if (refused) return refused;

    const auth = request.headers.get('authorization') || '';
    const access = verify(auth.replace(/^Bearer /, ''), 'access', settings.secret);
    if (!access || access.ip !== clientHash(request, settings)) {
        return error(401, 'token', 'Missing or expired access token.');
    }
    if (overRate(access.sid)) {
        return error(429, 'rate', 'Too many requests through the network proxy. Wait a minute.');
    }

    let target;
    try {
        target = JSON.parse(Buffer.from(request.headers.get('x-proxy-request') || '', 'base64url').toString());
    } catch {
        return error(400, 'request', 'Unreadable X-Proxy-Request.');
    }
    const method = String(target?.method || '').toUpperCase();
    if (!METHODS.has(method)) {
        return error(400, 'method', `Method ${method} isn't allowed.`);
    }
    let url;
    try {
        url = new URL(target.url);
    } catch {
        return error(400, 'url', 'Not a valid URL.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return error(400, 'url', 'Only http and https URLs.');
    }
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    if (port !== 80 && port !== 443) {
        return error(403, 'port', 'Only ports 80 and 443.');
    }
    if (url.username || url.password) {
        return error(400, 'url', 'No credentials in the URL; send an Authorization header.');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isBlockedAddress(host)) {
        return error(403, 'address', `${host} is a private or reserved address.`);
    }

    const headers = {};
    for (const [name, value] of Array.isArray(target.headers) ? target.headers : []) {
        const key = String(name).toLowerCase();
        if (!DROP_REQUEST.has(key) && /^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key)) {
            headers[key] = String(value).replace(/[\r\n]/g, '');
        }
    }
    const body = Buffer.from(await request.arrayBuffer());
    if (body.length > MAX_REQUEST_BYTES) {
        return error(413, 'too_large', 'The request body is over 1 MB.');
    }
    if (body.length > 0 || !['GET', 'HEAD'].includes(method)) {
        headers['content-length'] = String(body.length);
    }

    const started = Date.now();
    let upstream;
    try {
        upstream = await send(url, port, method, headers, body);
    } catch (err) {
        log(url, method, access, err.code || 'error', 0, started);
        return upstreamError(err, url);
    }
    log(url, method, access, upstream.status, upstream.body.length, started);
    const meta = Buffer.from(JSON.stringify({
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers,
    })).toString('base64url');
    return new Response(upstream.body, {
        status: 200,
        headers: {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'no-store',
            'X-Proxy-Response': meta,
        },
    });
}

function send(url, port, method, headers, body) {
    return new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const outgoing = client.request(
            {
                protocol: url.protocol,
                hostname: url.hostname.replace(/^\[|\]$/g, ''),
                port,
                path: `${url.pathname}${url.search}`,
                method,
                headers,
                lookup: safeLookup,
                agent: false,
                servername: net.isIP(url.hostname) ? undefined : url.hostname,
                timeout: TIMEOUT_MS,
            },
            (incoming) => {
                const chunks = [];
                let size = 0;
                incoming.on('data', (chunk) => {
                    size += chunk.length;
                    if (size > MAX_RESPONSE_BYTES) {
                        const tooLarge = new Error('The response is over 5 MB.');
                        tooLarge.code = 'ETOOLARGE';
                        outgoing.destroy(tooLarge);
                        return;
                    }
                    chunks.push(chunk);
                });
                incoming.on('end', () => {
                    const pairs = [];
                    for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
                        const name = incoming.rawHeaders[i];
                        if (!DROP_RESPONSE.has(name.toLowerCase())) pairs.push([name, incoming.rawHeaders[i + 1]]);
                    }
                    resolve({ status: incoming.statusCode, statusText: incoming.statusMessage, headers: pairs, body: Buffer.concat(chunks) });
                });
                incoming.on('error', reject);
            },
        );
        const deadline = setTimeout(() => outgoing.destroy(Object.assign(new Error('Timed out'), { code: 'ETIMEDOUT' })), TIMEOUT_MS);
        outgoing.on('close', () => clearTimeout(deadline));
        outgoing.on('timeout', () => outgoing.destroy(Object.assign(new Error('Timed out'), { code: 'ETIMEDOUT' })));
        outgoing.on('error', reject);
        outgoing.end(body);
    });
}

function upstreamError(err, url) {
    switch (err.code) {
        case 'EBLOCKED':
            return error(403, 'address', err.message);
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
            return error(502, 'dns', `Couldn't find ${url.hostname}.`);
        case 'ETIMEDOUT':
            return error(504, 'timeout', `${url.hostname} took too long to answer.`);
        case 'ETOOLARGE':
            return error(502, 'too_large', err.message);
        case 'ECONNREFUSED':
            return error(502, 'refused', `${url.hostname} refused the connection.`);
        default:
            return error(502, 'connect', `Couldn't reach ${url.hostname}.`);
    }
}

function log(url, method, access, status, bytes, started) {
    console.log(JSON.stringify({ proxy: url.hostname, method, status, bytes, ms: Date.now() - started, sid: access.sid }));
}
