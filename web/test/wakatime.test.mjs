import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const storage = new Map();
globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
};
globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
globalThis.setInterval = () => 0;
Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/142.0.0.0 Safari/537.36', platform: 'MacIntel', onLine: true },
    configurable: true,
});
const requests = [];
globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options, body: options.body && JSON.parse(options.body) });
    return url.endsWith('/statusbar/today')
        ? Response.json({ data: { grand_total: { text: '1 hr 5 mins' } } })
        : Response.json({ responses: [] }, { status: 201 });
};

const { WakaTime, heartbeat, pythonDependencies, userAgent, validApiKey } = await import('../src/wakatime.js');

const vscode = JSON.parse(readFileSync(new URL('./fixtures/vscode-heartbeats.json', import.meta.url), 'utf8'));
const weather = readFileSync(new URL('../src/examples/weather/code.py', import.meta.url), 'utf8');
const KEY = 'waka_00000000-0000-4000-8000-000000000000';

const at = { path: '/code.py', project: 'Weather', text: weather, lineno: 7, cursorpos: 13, lines: 40, time: 1792787400.5 };

function comparable(beat) {
    const { entity, project_root_count, user_agent, ...rest } = beat;
    return rest;
}

test('a save matches VS Code', () => {
    const ours = heartbeat({ ...at, isWrite: true, humanLineChanges: 3 });
    assert.deepEqual(comparable(ours), comparable(vscode.save.heartbeat));
    assert.deepEqual(Object.keys(ours).sort(), Object.keys(vscode.save.heartbeat).sort());
    assert.equal(ours.entity, '/Weather/code.py');
    assert.equal(ours.project_root_count, 2);
});

test('an edit matches VS Code', () => {
    const ours = heartbeat({ ...at, isWrite: false, humanLineChanges: 0 });
    assert.deepEqual(comparable(ours), comparable(vscode.edit.heartbeat));
    assert.deepEqual(Object.keys(ours).sort(), Object.keys(vscode.edit.heartbeat).sort());
});

test('the user agent has the form wakatime-cli sends', () => {
    assert.match(vscode.save.heartbeat.user_agent, /^wakatime\/\S+ \(darwin-[^)]+\) go\S+ vscode\/\S+ vscode-wakatime\/\S+$/);
    assert.equal(userAgent(), 'wakatime/v1.0.0 (darwin-unknown-unknown) browser-cyd/1.0.0 browser-cyd-wakatime/1.0.0');
});

test('dependencies follow wakatime-cli', () => {
    assert.deepEqual(pythonDependencies(weather), vscode.save.heartbeat.dependencies);
    assert.deepEqual(
        pythonDependencies('import os, sys\nimport a.b as c, d\nfrom . import e\nfrom .f import g\nfrom __future__ import annotations\n  import h  # i\nimport a\n'),
        ['a', 'h'],
    );
    assert.equal(heartbeat({ ...at, path: '/settings.toml', text: 'import x' }).dependencies, undefined);
});

test('a non-Python file gets its language, or none', () => {
    assert.equal(heartbeat({ ...at, path: '/settings.toml' }).language, 'TOML');
    assert.equal('language' in heartbeat({ ...at, path: '/data.bin' }), false);
});

test('API keys are checked as wakatime-cli does', () => {
    assert.equal(validApiKey(KEY), true);
    assert.equal(validApiKey('00000000-0000-4000-8000-000000000000'), true);
    assert.equal(validApiKey('waka_test'), false);
    assert.equal(validApiKey('00000000-0000-1000-8000-000000000000'), false);
});

test('requests to WakaTime carry the same headers as VS Code', async () => {
    requests.length = 0;
    const wakatime = new WakaTime();
    wakatime.configure({ apiKey: KEY, apiUrl: 'https://api.wakatime.com/api/v1', enabled: true });
    wakatime.activity({ ...at, isWrite: true });
    await wakatime.send();
    const sent = requests.find((request) => request.url.endsWith('/heartbeats.bulk'));
    assert.equal(sent.method, vscode.save.method);
    assert.equal(new URL(sent.url).pathname, vscode.save.path);
    const expected = Object.keys(vscode.save.headers).filter((name) => name !== 'user-agent');
    assert.deepEqual(Object.keys(sent.headers).map((name) => name.toLowerCase()).sort(), expected.sort());
    assert.equal(sent.headers.Authorization, `Basic ${btoa(KEY)}`);
    assert.equal(sent.headers.Timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(sent.body.length, 1);
    assert.equal(sent.body[0].is_write, true);
    assert.equal('machine' in sent.body[0], false);
});

test('Hackatime gets the machine in the heartbeat, and no extra headers', async () => {
    requests.length = 0;
    const wakatime = new WakaTime();
    wakatime.configure({ apiKey: KEY, apiUrl: 'https://hackatime.hackclub.com/api/hackatime/v1', enabled: true });
    wakatime.activity({ ...at, path: '/boot.py' });
    await wakatime.send();
    const sent = requests.find((request) => request.url.endsWith('/heartbeats.bulk'));
    assert.deepEqual(Object.keys(sent.headers).sort(), ['Accept', 'Authorization', 'Content-Type']);
    assert.equal(sent.body[0].machine, 'Chrome on macOS');
});

test('heartbeats follow the plugin timing rules', () => {
    const wakatime = new WakaTime();
    wakatime.configure({ apiKey: KEY, apiUrl: 'https://api.wakatime.com/api/v1', enabled: true });
    wakatime.queue.length = 0;
    wakatime.activity({ ...at, path: '/a.py' });
    wakatime.activity({ ...at, path: '/a.py', lineno: 8 });
    wakatime.activity({ ...at, path: '/b.py' });
    wakatime.activity({ ...at, path: '/b.py', isWrite: true });
    wakatime.activity({ ...at, path: '/b.py', isWrite: true });
    assert.deepEqual(wakatime.queue.map((beat) => [beat.entity, beat.is_write ?? false]), [
        ['/Weather/a.py', false],
        ['/Weather/b.py', false],
        ['/Weather/b.py', true],
    ]);
});

test('typed lines are counted, pastes are not', () => {
    const wakatime = new WakaTime();
    wakatime.configure({ apiKey: KEY, apiUrl: 'https://api.wakatime.com/api/v1', enabled: true });
    wakatime.queue.length = 0;
    wakatime.activity({ ...at, path: '/c.py', lines: 10 });
    wakatime.edited('/c.py', 12);
    wakatime.edited('/c.py', 13);
    wakatime.activity({ ...at, path: '/c.py', lines: 13, isWrite: true });
    wakatime.edited('/c.py', 100);
    wakatime.activity({ ...at, path: '/c.py', lines: 100, lineno: 90, isWrite: true });
    assert.deepEqual(wakatime.queue.map((beat) => beat.human_line_changes), [undefined, 3, undefined]);
});
