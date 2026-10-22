import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_SECONDS = 60 * 60;
export const ACCESS_SECONDS = 5 * 60;

export function sign(payload, secret) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${mac(body, secret)}`;
}

export function verify(token, kind, secret) {
    if (typeof token !== 'string') return null;
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;
    const expected = Buffer.from(mac(body, secret));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    let payload;
    try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
        return null;
    }
    if (payload.kind !== kind || !(payload.exp > Date.now() / 1000)) return null;
    return payload;
}

function mac(body, secret) {
    return createHmac('sha256', secret).update(body).digest('base64url');
}

export function newId() {
    return randomBytes(12).toString('base64url');
}

export function addressHash(address, secret) {
    return createHash('sha256').update(`${secret}:${address}`).digest('base64url').slice(0, 16);
}
