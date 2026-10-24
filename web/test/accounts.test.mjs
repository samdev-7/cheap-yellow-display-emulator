import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { after, before, test } from 'node:test';

import pg from 'pg';

import { handleAccount, handleCallback, handleDevLogin, handleLogin, handleLogout } from '../server/auth.js';

const DEV_URL = process.env.DATABASE_URL;
const skip = DEV_URL ? false : 'no DATABASE_URL: run npm run db';

const SITE = 'http://localhost:5173';
let env;
let hca;
let testDb;

const mock = { person: { sub: 'ident!abc123', name: 'Ada Lovelace' }, idClaims: {}, revoked: [], codes: new Map() };

before(async () => {
    if (skip) return;
    const url = new URL(DEV_URL);
    url.pathname = '/cyd_accounts_test';
    assert.match(url.pathname, /_test$/);
    const admin = new pg.Client({ connectionString: DEV_URL });
    await admin.connect();
    const exists = await admin.query("select 1 from pg_database where datname = 'cyd_accounts_test'");
    if (!exists.rows.length) await admin.query('create database cyd_accounts_test');
    await admin.end();
    testDb = new pg.Pool({ connectionString: url.href, max: 2 });
    await testDb.query('drop schema public cascade; create schema public');

    hca = http.createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        const path = req.url.split('?')[0];
        const reply = (status, value) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(value));
        };
        if (path === '/oauth/token') {
            const form = new URLSearchParams(body);
            const nonce = mock.codes.get(form.get('code'));
            if (!nonce || form.get('client_secret') !== 'test-secret' || form.get('redirect_uri') !== `${SITE}/api/auth/callback`) return reply(400, { error: 'invalid_grant' });
            mock.codes.delete(form.get('code'));
            const claims = { iss: env.HCA_ISSUER, aud: 'test-client', sub: mock.person.sub, exp: Date.now() / 1000 + 300, nonce, ...mock.idClaims };
            const jwt = ['{"alg":"RS256"}', JSON.stringify(claims)].map((part) => Buffer.from(part).toString('base64url')).join('.') + '.signature';
            return reply(200, { access_token: 'idntk.access', refresh_token: 'idnrf.refresh', token_type: 'Bearer', id_token: jwt });
        }
        if (path === '/oauth/userinfo') {
            return req.headers.authorization === 'Bearer idntk.access' ? reply(200, mock.person) : reply(401, {});
        }
        if (path === '/oauth/revoke') {
            mock.revoked.push(new URLSearchParams(body).get('token'));
            return reply(200, {});
        }
        reply(404, {});
    });
    await new Promise((resolve) => hca.listen(0, '127.0.0.1', resolve));
    env = {
        dev: true,
        DATABASE_URL: url.href,
        HCA_ISSUER: `http://127.0.0.1:${hca.address().port}`,
        HCA_CLIENT_ID: 'test-client',
        HCA_CLIENT_SECRET: 'test-secret',
        AUTH_SECRET: 'test-auth-secret',
        APP_ORIGIN: SITE,
    };
});

after(async () => {
    await testDb?.end();
    hca?.close();
    setImmediate(() => process.exit(process.exitCode ?? 0));
});

const request = (path, { method = 'GET', cookie, body, site = 'same-origin' } = {}) =>
    new Request(`${SITE}${path}`, {
        method,
        headers: { ...(cookie ? { cookie } : {}), 'sec-fetch-site': site, 'content-type': 'application/json', 'user-agent': 'test' },
        body: body && JSON.stringify(body),
    });

const cookiesOf = (response) => Object.fromEntries(response.headers.getSetCookie().map((value) => value.split(';')[0].split('=')));
const cookieHeader = (cookies) => Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');

async function signInWithHca({ tamper } = {}) {
    const login = await handleLogin(request('/api/auth/login'), env);
    assert.equal(login.status, 302);
    const sentTo = new URL(login.headers.get('location'));
    const code = `code-${Math.random()}`;
    mock.codes.set(code, sentTo.searchParams.get('nonce'));
    const params = new URLSearchParams({ code, state: sentTo.searchParams.get('state') });
    const cookies = cookiesOf(login);
    tamper?.(params, cookies);
    return handleCallback(request(`/api/auth/callback?${params}`, { cookie: cookieHeader(cookies), site: 'cross-site' }), env);
}

async function whoIs(cookies) {
    return (await (await handleAccount(request('/api/account', { cookie: cookieHeader(cookies) }), env)).json()).user;
}

test('login sends you to Hack Club Auth with only the scopes needed', { skip }, async () => {
    const response = await handleLogin(request('/api/auth/login'), env);
    const url = new URL(response.headers.get('location'));
    assert.equal(url.origin + url.pathname, `${env.HCA_ISSUER}/oauth/authorize`);
    assert.equal(url.searchParams.get('client_id'), 'test-client');
    assert.equal(url.searchParams.get('redirect_uri'), `${SITE}/api/auth/callback`);
    assert.equal(url.searchParams.get('scope'), 'openid profile');
    assert.ok(url.searchParams.get('state') && url.searchParams.get('nonce'));
    const state = response.headers.getSetCookie()[0];
    assert.match(state, /^cyd_auth_state=.+; Path=\/api\/auth; Max-Age=600; HttpOnly; SameSite=Lax/);
});

test('signing in makes a session; only its hash is stored; Hack Club tokens are revoked', { skip }, async () => {
    mock.revoked.length = 0;
    const response = await signInWithHca();
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `${SITE}/?signin=ok`);
    const cookies = cookiesOf(response);
    assert.ok(cookies.cyd_account.length > 30);
    assert.equal(cookies.cyd_auth_state, '');
    assert.deepEqual(await whoIs(cookies), { name: 'Ada Lovelace', local: false });

    const { rows } = await testDb.query('select s.token_hash, u.identity, u.name from sessions s join users u on u.id = s.user_id');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].identity, 'hca:ident!abc123');
    assert.equal(rows[0].token_hash, createHash('sha256').update(cookies.cyd_account).digest('base64url'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(mock.revoked.sort(), ['idnrf.refresh', 'idntk.access']);
});

test('signing in again is the same user, with a new name if it changed', { skip }, async () => {
    mock.person = { sub: 'ident!abc123', name: 'Ada King' };
    const cookies = cookiesOf(await signInWithHca());
    assert.equal((await whoIs(cookies)).name, 'Ada King');
    const { rows } = await testDb.query("select count(*)::int as n from users where identity = 'hca:ident!abc123'");
    assert.equal(rows[0].n, 1);
});

test('a sign-in that isn\'t this browser\'s is refused', { skip }, async () => {
    const wrongState = await signInWithHca({ tamper: (params) => params.set('state', 'someone-elses') });
    assert.equal(wrongState.headers.get('location'), `${SITE}/?signin=failed`);
    const noCookie = await signInWithHca({ tamper: (params, cookies) => delete cookies.cyd_auth_state });
    assert.equal(noCookie.headers.get('location'), `${SITE}/?signin=failed`);
    const forgedCookie = await signInWithHca({ tamper: (params, cookies) => (cookies.cyd_auth_state = cookies.cyd_auth_state.replace(/.$/, 'x')) });
    assert.equal(forgedCookie.headers.get('location'), `${SITE}/?signin=failed`);
    assert.equal(cookiesOf(wrongState).cyd_account, undefined);
});

test('an ID token for another app, issuer or sign-in is refused', { skip }, async () => {
    for (const claims of [{ aud: 'another-app' }, { iss: 'https://evil.example' }, { nonce: 'replayed' }, { exp: 1 }]) {
        mock.idClaims = claims;
        const response = await signInWithHca();
        assert.equal(response.headers.get('location'), `${SITE}/?signin=failed`, JSON.stringify(claims));
    }
    mock.idClaims = {};
});

test('cancelling on Hack Club Auth says so', { skip }, async () => {
    const response = await handleCallback(request('/api/auth/callback?error=access_denied&state=x', { site: 'cross-site' }), env);
    assert.equal(response.headers.get('location'), `${SITE}/?signin=cancelled`);
});

test('without Hack Club Auth set up, login says so', { skip }, async () => {
    const response = await handleLogin(request('/api/auth/login'), { ...env, HCA_CLIENT_SECRET: '' });
    assert.equal(response.headers.get('location'), `${SITE}/?signin=unavailable`);
});

test('signing out ends this session only; everywhere ends them all', { skip }, async () => {
    mock.person = { sub: 'ident!xyz', name: 'Grace' };
    const first = cookiesOf(await signInWithHca());
    const second = cookiesOf(await signInWithHca());
    const third = cookiesOf(await signInWithHca());

    const out = await handleLogout(request('/api/auth/logout', { method: 'POST', cookie: cookieHeader(first), body: {} }), env);
    assert.equal(out.status, 200);
    assert.match(out.headers.getSetCookie()[0], /^cyd_account=; Path=\/api; Max-Age=0/);
    assert.equal(await whoIs(first), null);
    assert.equal((await whoIs(second)).name, 'Grace');

    await handleLogout(request('/api/auth/logout', { method: 'POST', cookie: cookieHeader(second), body: { everywhere: true } }), env);
    assert.equal(await whoIs(second), null);
    assert.equal(await whoIs(third), null);
});

test('another site can\'t sign you out', { skip }, async () => {
    const cookies = cookiesOf(await signInWithHca());
    const response = await handleLogout(request('/api/auth/logout', { method: 'POST', cookie: cookieHeader(cookies), site: 'cross-site' }), env);
    assert.equal(response.status, 403);
    assert.ok(await whoIs(cookies));
});

test('made-up or expired sessions aren\'t signed in', { skip }, async () => {
    assert.equal(await whoIs({ cyd_account: 'made-up' }), null);
    const cookies = cookiesOf(await signInWithHca());
    await testDb.query("update sessions set expires_at = now() - interval '1 second'");
    assert.equal(await whoIs(cookies), null);
});

test('development sign-in: anyone@local, only on the dev server', { skip }, async () => {
    const response = await handleDevLogin(request('/api/auth/dev', { method: 'POST', body: { email: 'Sam@local' } }), env);
    assert.equal(response.status, 200);
    const cookies = cookiesOf(response);
    assert.deepEqual(await whoIs(cookies), { name: 'sam', local: true });
    const { rows } = await testDb.query("select identity from users where identity like 'local:%'");
    assert.deepEqual(rows, [{ identity: 'local:sam@local' }]);

    for (const email of ['sam@hackclub.com', 'sam', '@local', 'a b@local', 'x'.repeat(40) + '@local']) {
        const refused = await handleDevLogin(request('/api/auth/dev', { method: 'POST', body: { email } }), env);
        assert.equal(refused.status, 400, email);
    }
    const crossSite = await handleDevLogin(request('/api/auth/dev', { method: 'POST', body: { email: 'sam@local' }, site: 'cross-site' }), env);
    assert.equal(crossSite.status, 403);
    const deployed = await handleDevLogin(request('/api/auth/dev', { method: 'POST', body: { email: 'sam@local' } }), { ...env, dev: false });
    assert.equal(deployed.status, 404);
});
