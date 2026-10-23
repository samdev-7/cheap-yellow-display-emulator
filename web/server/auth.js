import { createHash, randomBytes } from 'node:crypto';

import { database } from './db.js';
import { error, json, sameOrigin } from './guard.js';
import { sign, verify } from './tokens.js';

export const ACCOUNT_COOKIE = 'cyd_account';
const STATE_COOKIE = 'cyd_auth_state';
const SESSION_DAYS = 30;
const STATE_SECONDS = 10 * 60;
const SCOPES = 'openid profile';
const DEV_EMAIL = /^([a-z0-9][a-z0-9._-]{0,31})@local$/i;

export function authConfig(env) {
    const dev = Boolean(env.dev);
    return {
        dev,
        issuer: (env.HCA_ISSUER || 'https://auth.hackclub.com').replace(/\/+$/, ''),
        clientId: env.HCA_CLIENT_ID || '',
        clientSecret: env.HCA_CLIENT_SECRET || '',
        secret: env.AUTH_SECRET || (dev ? devSecret : ''),
        origin: env.APP_ORIGIN || '',
    };
}

const devSecret = `dev-${randomBytes(16).toString('hex')}`;

function origin(request, settings) {
    return settings.origin || (settings.dev ? new URL(request.url).origin : '');
}

function cookie(name, value, { path, maxAge, dev }) {
    return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${dev ? '' : '; Secure'}`;
}

function readCookie(request, name) {
    for (const part of (request.headers.get('cookie') || '').split(';')) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) return value.join('=');
    }
    return null;
}

function redirect(location, cookies = []) {
    const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
    for (const value of cookies) headers.append('Set-Cookie', value);
    return new Response(null, { status: 302, headers });
}

const hash = (token) => createHash('sha256').update(token).digest('base64url');

export async function handleLogin(request, env) {
    const settings = authConfig(env);
    const site = origin(request, settings);
    if (!settings.clientId || !settings.clientSecret || !settings.secret || !site) {
        return redirect(`${site}/?signin=unavailable`);
    }
    const state = randomBytes(16).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + STATE_SECONDS;
    const url = new URL(`${settings.issuer}/oauth/authorize`);
    url.search = new URLSearchParams({
        client_id: settings.clientId,
        redirect_uri: `${site}/api/auth/callback`,
        response_type: 'code',
        scope: SCOPES,
        state,
        nonce,
    });
    return redirect(url.href, [
        cookie(STATE_COOKIE, sign({ kind: 'auth-state', state, nonce, exp }, settings.secret), { path: '/api/auth', maxAge: STATE_SECONDS, dev: settings.dev }),
    ]);
}

export async function handleCallback(request, env) {
    const settings = authConfig(env);
    const site = origin(request, settings);
    const params = new URL(request.url).searchParams;
    const clearState = cookie(STATE_COOKIE, '', { path: '/api/auth', maxAge: 0, dev: settings.dev });
    const back = (outcome, cookies = []) => redirect(`${site}/?signin=${outcome}`, [clearState, ...cookies]);

    if (!site || !settings.clientId || !settings.clientSecret || !settings.secret) return back('unavailable');
    if (params.get('error')) return back('cancelled');
    const saved = verify(readCookie(request, STATE_COOKIE), 'auth-state', settings.secret);
    if (!saved || !params.get('code') || params.get('state') !== saved.state) return back('failed');

    let identity;
    try {
        identity = await fetchIdentity(params.get('code'), saved.nonce, `${site}/api/auth/callback`, settings);
    } catch {
        return back('failed');
    }
    const pool = await database(env);
    if (!pool) return back('unavailable');
    const session = await startSession(pool, `hca:${identity.id}`, identity.name, request, settings.dev);
    return back('ok', [session]);
}

async function fetchIdentity(code, nonce, redirectUri, settings) {
    const tokens = await fetch(`${settings.issuer}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: settings.clientId,
            client_secret: settings.clientSecret,
        }),
        signal: AbortSignal.timeout(10_000),
    }).then((response) => (response.ok ? response.json() : Promise.reject(new Error(`token ${response.status}`))));

    const claims = decodeJwt(tokens.id_token);
    const now = Date.now() / 1000;
    const audience = [claims?.aud].flat();
    if (!claims || claims.iss !== settings.issuer || !audience.includes(settings.clientId) || !(claims.exp > now) || claims.nonce !== nonce || !claims.sub) {
        throw new Error('id token');
    }

    const info = await fetch(`${settings.issuer}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
    }).then((response) => (response.ok ? response.json() : Promise.reject(new Error(`userinfo ${response.status}`))));
    if (info.sub !== claims.sub) throw new Error('userinfo');

    for (const token of [tokens.access_token, tokens.refresh_token].filter(Boolean)) {
        fetch(`${settings.issuer}/oauth/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token, client_id: settings.clientId, client_secret: settings.clientSecret }),
            signal: AbortSignal.timeout(5_000),
        }).catch(() => {});
    }

    const name = [info.name, info.nickname, [info.given_name, info.family_name].filter(Boolean).join(' ')].find((value) => typeof value === 'string' && value.trim());
    return { id: claims.sub, name: (name || 'Hack Clubber').trim().slice(0, 100) };
}

function decodeJwt(token) {
    try {
        return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
    } catch {
        return null;
    }
}

async function startSession(pool, identity, name, request, dev) {
    const { rows } = await pool.query(
        `insert into users (identity, name) values ($1, $2)
         on conflict (identity) do update set name = excluded.name, last_seen_at = now()
         returning id`,
        [identity, name],
    );
    const token = randomBytes(32).toString('base64url');
    await pool.query(
        `insert into sessions (token_hash, user_id, user_agent, expires_at)
         values ($1, $2, $3, now() + make_interval(days => $4))`,
        [hash(token), rows[0].id, (request.headers.get('user-agent') || '').slice(0, 300), SESSION_DAYS],
    );
    return cookie(ACCOUNT_COOKIE, token, { path: '/api', maxAge: SESSION_DAYS * 86400, dev });
}

export async function currentUser(request, pool) {
    const token = readCookie(request, ACCOUNT_COOKIE);
    if (!token || token.length > 100) return null;
    const { rows } = await pool.query(
        `update sessions set last_used_at = now()
         where token_hash = $1 and expires_at > now()
         returning user_id`,
        [hash(token)],
    );
    if (!rows[0]) return null;
    const user = await pool.query('select id, identity, name from users where id = $1', [rows[0].user_id]);
    return user.rows[0] ?? null;
}

export async function handleAccount(request, env) {
    const pool = await database(env);
    if (!pool) return json(200, { user: null, available: false });
    const user = await currentUser(request, pool);
    return json(200, {
        available: true,
        user: user && { name: user.name, local: user.identity.startsWith('local:') },
    });
}

export async function handleLogout(request, env) {
    if (request.method !== 'POST') return error(405, 'method', 'Use POST.');
    if (!sameOrigin(request)) return error(403, 'origin', 'Only the editor on this site can sign out.');
    const settings = authConfig(env);
    const pool = await database(env);
    const token = readCookie(request, ACCOUNT_COOKIE);
    if (pool && token) {
        const { everywhere } = await request.json().catch(() => ({}));
        if (everywhere) {
            await pool.query('delete from sessions where user_id = (select user_id from sessions where token_hash = $1)', [hash(token)]);
        } else {
            await pool.query('delete from sessions where token_hash = $1', [hash(token)]);
        }
    }
    return json(200, { user: null }, { 'Set-Cookie': cookie(ACCOUNT_COOKIE, '', { path: '/api', maxAge: 0, dev: settings.dev }) });
}

export async function handleDevLogin(request, env) {
    const settings = authConfig(env);
    if (!settings.dev) return error(404, 'not_found', 'Not found.');
    if (request.method !== 'POST') return error(405, 'method', 'Use POST.');
    if (!sameOrigin(request)) return error(403, 'origin', 'Only the editor on this site can sign in.');
    const { email } = await request.json().catch(() => ({}));
    const match = DEV_EMAIL.exec(String(email || '').trim());
    if (!match) return error(400, 'email', 'Use a name ending in @local, like sam@local.');
    const pool = await database(env);
    if (!pool) return error(503, 'no_database', 'No database: run npm run db.');
    const name = match[1].toLowerCase();
    const session = await startSession(pool, `local:${name}@local`, name, request, true);
    return json(200, { user: { name, local: true } }, { 'Set-Cookie': session });
}
