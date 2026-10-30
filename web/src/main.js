import './style.css';
import '@xterm/xterm/css/xterm.css';

import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentUnit } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import JSZip from 'jszip';

import { Emulator } from './emulator/emulator.js';
import { CARD_SIZES_GB, blankCard, formattedCard } from './emulator/sdcard.js';
import { DEFAULT_NAME, EXAMPLES, ProjectStore, normalisePath } from './project.js';
import { NetworkProxy } from './net/proxy.js';
import { NetworkBridge } from './net/network.js';
import { WIFI_MODE } from './emulator/network.js';
import { RESET_REASON } from './emulator/shared.js';
import { BoardView } from './ui/boardView.js';
import { FileTree } from './ui/fileTree.js';
import { el } from './ui/el.js';
import { Menu } from './ui/menu.js';
import { initSplitters } from './ui/splitters.js';
import { SERVERS, WakaTime, normaliseApiUrl, validApiKey } from './wakatime.js';

const $ = (id) => document.getElementById(id);

if (!crossOriginIsolated) {
    $('status').textContent =
        "The emulator can't start: this page isn't served with cross-origin isolation headers (COOP and COEP).";
}

const store = await ProjectStore.load();
let project = await store.openCurrent();
const esp32Speed = Number(new URLSearchParams(location.search).get('esp32-speed')) || 1;
const emulator = new Emulator({ firmwareUrl: `${import.meta.env.BASE_URL}firmware/circuitpython.mjs`, esp32Speed: Math.max(1, esp32Speed) });

let boardFiles = null;
let openPath = '/code.py';
const unsaved = new Set();

const panes = initSplitters($('workspace'));

let saveTimer = 0;
function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow(), 300);
}

function saveNow() {
    clearTimeout(saveTimer);
    project.board.nvm = emulator.nvmSnapshot();
    return store.save(project);
}

function keep() {
    if (!project.draft) return;
    store.add(project);
    showName();
}

const tree = new FileTree($('file-tree'), project, {
    open: (path) => openFile(path),
    openPath: () => openPath,
    isUnsaved: (path) => unsaved.has(path),
    notify: (message) => setStatus(message),
    dropped: (folder, files) => addFiles(folder, files),
    created: (path, kind) => {
        if (kind === 'folder') {
            project.mkdir(path);
        } else {
            project.writeText(path, '');
            unsaved.add(path);
        }
        changed();
        if (kind === 'file') {
            openFile(path);
        }
    },
    renamed: (from, to) => {
        project.rename(from, to);
        remap(from, to);
        if (within(openPath, from)) {
            openPath = to + openPath.slice(from.length);
            reopen();
        }
        changed();
    },
    deleted: (path) => {
        project.remove(path);
        remap(path, null);
        if (!project.has(openPath)) {
            openPath = firstFile();
            reopen();
        }
        changed();
    },
});

const within = (path, folder) => path === folder || path.startsWith(folder + '/');

function remap(from, to) {
    for (const path of [...unsaved]) {
        if (!within(path, from)) continue;
        unsaved.delete(path);
        if (to) unsaved.add(to + path.slice(from.length));
    }
    for (const [path, state] of [...editorStates]) {
        if (!within(path, from)) continue;
        editorStates.delete(path);
        if (to) editorStates.set(to + path.slice(from.length), state);
    }
}

function changed() {
    keep();
    scheduleSave();
    tree.render();
}

function firstFile() {
    return project.has('/code.py') ? '/code.py' : project.list()[0]?.path ?? '/code.py';
}

$('new-file').onclick = () => tree.startCreate('file');
$('new-folder').onclick = () => tree.startCreate('folder');
$('upload').onclick = () => $('upload-input').click();
$('upload-input').onchange = async (event) => {
    await addFiles(tree.targetFolder(), [...event.target.files]);
    event.target.value = '';
};

async function addFiles(folder, files) {
    for (const file of files) {
        const into = !folder && /\.mpy$/.test(file.name) ? '/lib' : folder;
        const path = normalisePath(`${into}/${file.name}`);
        if (!path) continue;
        project.write(path, new Uint8Array(await file.arrayBuffer()));
        unsaved.add(path);
    }
    changed();
}

const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
const editorHost = $('editor');
const editorStates = new Map();
let view = null;

function editorState(path, text) {
    const extensions = [
        basicSetup,
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (flash(), true) }]),
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                project.writeText(openPath, update.state.doc.toString());
                keep();
                if (!unsaved.has(openPath)) {
                    unsaved.add(openPath);
                    tree.render();
                }
                scheduleSave();
                wakatime.edited(openPath, update.state.doc.lines);
            }
            if (update.docChanged || update.selectionSet) {
                showCursor();
                trackActivity();
            }
        }),
    ];
    if (path.endsWith('.py')) {
        extensions.push(python());
    }
    if (darkMode) {
        extensions.push(oneDark);
    }
    return EditorState.create({ doc: text, extensions });
}

function openFile(path) {
    if (view && project.has(openPath)) {
        editorStates.set(openPath, view.state);
    }
    openPath = path;
    reopen();
}

function reopen() {
    $('editor-title').textContent = openPath.slice(1);
    const text = project.has(openPath) ? project.readText(openPath) : '';
    if (text === null) {
        view?.destroy();
        view = null;
        editorHost.replaceChildren(
            el('div', { className: 'binary', textContent: `${openPath.slice(1)} is a binary file (${project.read(openPath).length} bytes). It is copied to the board as is.` }),
        );
    } else {
        const state = editorStates.get(openPath) ?? editorState(openPath, text);
        if (view) {
            view.setState(state);
        } else {
            editorHost.innerHTML = '';
            view = new EditorView({ state, parent: editorHost });
        }
    }
    tree.reveal(openPath);
    tree.render();
    showCursor();
    trackActivity();
}

function boot(options = {}) {
    if (!boardFiles) {
        flash();
        return;
    }
    emulator.start(boardFiles, project.board.card, options);
    showPower();
}

function flash() {
    trackActivity(true);
    saveNow();
    boardFiles = project.list();
    unsaved.clear();
    tree.render();
    emulator.start(boardFiles, project.board.card);
    showPower();
}

emulator.addEventListener('files-applied', (event) => {
    const { errors } = event.detail;
    setStatus(errors ? `${errors} file(s) didn't fit on CIRCUITPY (the drive is full)` : 'Running');
});

emulator.addEventListener('reset-requested', (event) => boot({ reason: event.detail.reason ?? RESET_REASON.POWER_ON }));
emulator.addEventListener('wake-requested', (event) => boot({ reason: RESET_REASON.DEEP_SLEEP_ALARM, wake: event.detail.wake }));

emulator.addEventListener('nvm', () => scheduleSave());

emulator.addEventListener('speed', (event) => {
    const { ratio } = event.detail;
    $('speed-warning').hidden = ratio === null;
    if (ratio !== null) {
        $('speed-warning-text').textContent = `Simulation can't keep up. Running ${ratio.toFixed(ratio < 0.1 ? 2 : 1)}x realtime`;
    }
});
emulator.addEventListener('state', (event) => setStatus(event.detail.message));

let statusHeld = 0;
let statusWaiting = null;
function setStatus(text, { hold = 0 } = {}) {
    if (!hold && Date.now() < statusHeld) {
        statusWaiting = text;
        return;
    }
    $('status').textContent = text;
    $('status').title = text;
    if (hold) {
        statusHeld = Date.now() + hold;
        statusWaiting = null;
        setTimeout(() => {
            if (statusWaiting !== null && Date.now() >= statusHeld) setStatus(statusWaiting);
        }, hold);
    }
}

$('run').onclick = () => flash();
$('reset').onclick = () => boot();

const board = new BoardView($('board'), emulator, {
    onReset: () => boot(),
    onLight: (level) => {
        project.board.light = level;
        scheduleSave();
    },
    onPower: () => setPower(!emulator.powered),
});

function showSide() {
    const back = project.board.side === 'back';
    board.setSide(back);
    $('flip').setAttribute('aria-pressed', String(back));
    $('flip').title = back ? 'Show the front of the board' : 'Show the back of the board';
}

$('flip').onclick = () => {
    project.board.side = project.board.side === 'back' ? 'front' : 'back';
    showSide();
    scheduleSave();
};

let switchedOff = false;
function setPower(on) {
    switchedOff = !on;
    if (on) {
        boot();
    } else {
        emulator.powerOff();
    }
    showPower();
}

function showPower() {
    const on = emulator.powered;
    board.setPowered(on);
    $('power').setAttribute('aria-pressed', String(on));
    $('power-label').textContent = on ? 'On' : 'Off';
    $('reset').disabled = !on;
}

$('power').onclick = () => setPower(!emulator.powered);

function showCard() {
    const inserted = project.board.card.inserted;
    emulator.setCardInserted(inserted);
    board.setCardInserted(inserted);
}

function setCardInserted(inserted) {
    const card = project.board.card;
    if (inserted && card.sectors === 0) {
        project.board.card = { ...formattedCard(card.sizeGB), inserted };
        emulator.replaceCard(project.board.card);
    } else {
        card.inserted = inserted;
    }
    showCard();
    scheduleSave();
}

function replaceCard(sizeGB, formatted, question) {
    if (!confirm(question)) return;
    const card = formatted ? formattedCard(sizeGB) : blankCard(sizeGB);
    project.board.card = { ...card, inserted: project.board.card.inserted };
    emulator.replaceCard(project.board.card);
    scheduleSave();
}

emulator.addEventListener('sd-blocks', (event) => {
    for (const [index, data] of event.detail) {
        project.board.card.blocks.set(index, data);
    }
    scheduleSave();
});

const proxy = new NetworkProxy();
emulator.network = new NetworkBridge({ proxy, wake: () => emulator.wake(), notice: (text) => setStatus(text) });

function showWifi() {
    const wifi = project.board.wifi;
    emulator.setWifiMode(
        (wifi.inRange ? 0 : WIFI_MODE.NO_NETWORKS) |
            (wifi.passwordAccepted ? 0 : WIFI_MODE.WRONG_PASSWORD) |
            (wifi.internet ? 0 : WIFI_MODE.NO_INTERNET) |
            (wifi.connectInstantly ? 0 : WIFI_MODE.REAL_TIMING),
    );
}

function toggleWifi(setting) {
    project.board.wifi[setting] = !project.board.wifi[setting];
    showWifi();
    scheduleSave();
}

const boardMenu = new Menu();
$('board-more').onclick = () => {
    const fullscreen = $('workspace').classList.contains('fullscreen');
    boardMenu.open($('board-more'), [
        { label: 'Wi-Fi', detail: wifiSummary(), submenu: wifiItems },
        { label: 'microSD card', detail: cardSummary(), submenu: cardItems },
        {
            label: 'Clear NVM',
            detail: project.board.nvm?.some((byte) => byte !== 0) ? 'In use' : 'Empty',
            run: () => {
                if (!confirm('Clear microcontroller.nvm? Everything the board saved there is lost.')) return;
                emulator.setNvm(null);
                saveNow();
            },
        },
        null,
        { label: fullscreen ? 'Exit full screen' : 'Full screen', run: () => setFullscreen(!fullscreen) },
    ]);
};

function setFullscreen(on) {
    $('workspace').classList.toggle('fullscreen', on);
    if (!on) view?.requestMeasure();
}

function wifiSummary() {
    const wifi = project.board.wifi;
    if (!wifi.inRange) return 'No networks';
    if (!wifi.passwordAccepted) return 'Wrong password';
    if (!wifi.internet) return 'No internet';
    return 'Normal';
}

function wifiItems() {
    const wifi = project.board.wifi;
    return [
        { label: 'Networks in range', checked: wifi.inRange, run: () => toggleWifi('inRange') },
        { label: 'Password accepted', checked: wifi.passwordAccepted, run: () => toggleWifi('passwordAccepted') },
        { label: 'Internet access', checked: wifi.internet, run: () => toggleWifi('internet') },
        { label: 'Connect instantly', checked: wifi.connectInstantly, run: () => toggleWifi('connectInstantly') },
        null,
        { label: 'Disconnect now', disabled: !emulator.powered, run: () => emulator.dropWifi() },
    ];
}

function cardSummary() {
    const card = project.board.card;
    return card.inserted ? `${card.sizeGB} GB, inserted` : 'Not inserted';
}

function cardItems() {
    const card = project.board.card;
    return [
        { label: card.inserted ? 'Eject card' : 'Insert card', run: () => setCardInserted(!card.inserted) },
        null,
        { heading: 'Size' },
        ...CARD_SIZES_GB.map((sizeGB) => ({
            label: `${sizeGB} GB`,
            checked: card.sizeGB === sizeGB,
            run: () => {
                if (sizeGB !== card.sizeGB) {
                    replaceCard(sizeGB, true, `Swap in a new ${sizeGB} GB card? Everything on the current card is lost.`);
                }
            },
        })),
        null,
        {
            label: 'Format card (FAT32)',
            run: () => replaceCard(card.sizeGB, true, 'Format the card? Everything on it is lost.'),
        },
        {
            label: 'Erase card (unformatted)',
            danger: true,
            run: () => replaceCard(card.sizeGB, false, 'Erase the card completely, leaving it unformatted?'),
        },
    ];
}

function showCursor() {
    $('cursor-position').hidden = !view;
    if (!view) return;
    const { state } = view;
    const { main } = state.selection;
    const line = state.doc.lineAt(main.head);
    const selected = main.to - main.from;
    $('cursor-position').textContent = `Ln ${line.number}, Col ${main.head - line.from + 1}${selected ? ` (${selected} selected)` : ''}`;
}

const wakatime = new WakaTime();

function trackActivity(isWrite = false) {
    if (!view) return;
    const { state } = view;
    const from = state.selection.main.from;
    const line = state.doc.lineAt(from);
    wakatime.activity({
        path: openPath,
        project: project.name,
        text: state.doc.toString(),
        lineno: line.number,
        cursorpos: from - line.from + 1,
        lines: state.doc.lines,
        isWrite,
    });
}

function showWakatime() {
    const button = $('wakatime');
    const name = wakatime.server?.name ?? 'WakaTime';
    const { apiKey, enabled } = wakatime.settings;
    const [text, title] = !apiKey
        ? ['WakaTime', 'Track your coding time with WakaTime or Hackatime']
        : !enabled
          ? ['Not tracking', `${name}: tracking is off`]
          : [wakatime.today ?? name, `${name}: ${wakatime.error ?? 'your coding time today'}`];
    $('wakatime-text').textContent = text;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.classList.toggle('problem', wakatime.active && Boolean(wakatime.error));
}
wakatime.addEventListener('change', showWakatime);
showWakatime();

const wakatimeMenu = new Menu();
$('wakatime').onclick = () => {
    if (!wakatime.settings.apiKey) {
        openWakatimeSettings();
        return;
    }
    wakatimeMenu.open($('wakatime'), [
        ...(wakatime.error ? [{ heading: wakatime.error }] : []),
        { label: 'Open dashboard', run: () => window.open(wakatime.dashboard, '_blank', 'noopener') },
        {
            label: 'Track my coding time',
            checked: wakatime.settings.enabled,
            run: () => wakatime.configure({ enabled: !wakatime.settings.enabled }),
        },
        null,
        { label: 'WakaTime settings…', run: () => openWakatimeSettings() },
    ]);
};

const wakatimeDialog = $('wakatime-dialog');

function chosenServer() {
    return SERVERS.find((server) => server.id === $('wakatime-server').value) ?? null;
}

function showServerChoice() {
    const server = chosenServer();
    $('wakatime-url-field').hidden = Boolean(server);
    $('wakatime-key-help').replaceChildren(
        server ? el('a', { href: server.keyPage, target: '_blank', rel: 'noopener', textContent: `Get your ${server.name} API key` }) : 'The api_key from your .wakatime.cfg.',
    );
}

function openWakatimeSettings() {
    const { apiUrl, apiKey, enabled } = wakatime.settings;
    const server = SERVERS.find((known) => known.apiUrl === apiUrl);
    $('wakatime-server').value = server?.id ?? 'custom';
    $('wakatime-url').value = server ? '' : apiUrl;
    $('wakatime-key').value = apiKey;
    $('wakatime-enabled').checked = enabled;
    $('wakatime-error').hidden = true;
    showServerChoice();
    wakatimeDialog.showModal();
}

$('wakatime-server').onchange = () => showServerChoice();
$('wakatime-cancel').onclick = () => wakatimeDialog.close();

$('wakatime-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const fail = (message) => {
        $('wakatime-error').textContent = message;
        $('wakatime-error').hidden = false;
    };
    const server = chosenServer();
    const apiUrl = server ? server.apiUrl : normaliseApiUrl($('wakatime-url').value);
    if (!apiUrl) {
        fail('Enter the server\'s API URL, starting with https://');
        return;
    }
    const apiKey = $('wakatime-key').value.trim();
    const enabled = $('wakatime-enabled').checked;
    if (apiKey && !validApiKey(apiKey)) {
        fail("That isn't an API key. It looks like waka_ followed by letters and numbers in groups, like waka_1a2b3c4d-....");
        return;
    }
    if (apiKey && enabled) {
        $('wakatime-save').disabled = true;
        $('wakatime-save').textContent = 'Checking…';
        const problem = await WakaTime.check(apiUrl, apiKey);
        $('wakatime-save').disabled = false;
        $('wakatime-save').textContent = 'Save';
        if (problem) {
            fail(problem);
            return;
        }
    }
    wakatime.configure({ apiUrl, apiKey, enabled });
    wakatimeDialog.close();
    trackActivity();
});

const terminal = new Terminal({
    convertEol: false,
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
    fontSize: 13,
    theme: { background: '#111214' },
    scrollback: 5000,
});
const fit = new FitAddon();
terminal.loadAddon(fit);
terminal.open($('console'));
fit.fit();
new ResizeObserver(() => fit.fit()).observe($('console'));
const encoder = new TextEncoder();
terminal.onData((data) => emulator.sendSerial(encoder.encode(data)));
emulator.addEventListener('serial', (event) => terminal.write(event.detail));
$('clear-console').onclick = () => terminal.clear();

const CONSOLE_KEY = 'cyd-console-hidden';
function showConsole(shown) {
    $('console-pane').classList.toggle('collapsed', !shown);
    $('toggle-console').textContent = shown ? 'Hide' : 'Show';
    $('toggle-console').setAttribute('aria-expanded', String(shown));
    try {
        localStorage.setItem(CONSOLE_KEY, shown ? '0' : '1');
    } catch {
    }
    if (shown) {
        requestAnimationFrame(() => fit.fit());
    }
}
$('toggle-console').onclick = () => showConsole($('console-pane').classList.contains('collapsed'));
let consoleHidden = false;
try {
    consoleHidden = localStorage.getItem(CONSOLE_KEY) === '1';
} catch {
    consoleHidden = false;
}
showConsole(!consoleHidden);

const nameInput = $('project-name');

function showProject() {
    if (project.newerFormat || store.newerFormat) {
        setStatus('Saved by a newer version of this editor: changes here won\'t be saved.');
    }
    showName();
    tree.project = project;
    editorStates.clear();
    view = null;
    openPath = firstFile();
    reopen();
    showSide();
    board.setLight(project.board.light);
    showCard();
    showWifi();
    emulator.setNvm(project.board.nvm);
    boardFiles = null;
    terminal.clear();
    if (!switchedOff) {
        flash();
    }
}

function showName() {
    nameInput.value = project.name;
    document.title = `${project.name} · CYD Emulator`;
}

async function switchTo(open) {
    await saveNow();
    project = await open();
    showProject();
}

nameInput.addEventListener('change', () => {
    const name = nameInput.value.trim();
    if (!name) {
        nameInput.value = project.name;
        return;
    }
    project.name = name;
    if (project.draft) {
        keep();
    } else {
        showName();
        saveNow();
    }
});
nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        nameInput.blur();
    } else if (event.key === 'Escape') {
        nameInput.value = project.name;
        nameInput.blur();
    }
});

function closeItem() {
    return { label: 'Close this example', run: () => switchTo(() => store.openCurrent()) };
}

function deleteItem() {
    return {
        label: 'Delete this project',
        danger: true,
        run: async () => {
            if (!confirm(`Delete "${project.name}" and its files?`)) return;
            clearTimeout(saveTimer);
            await store.remove(project.id);
            if (store.projects.length === 0) {
                project = store.newProject(DEFAULT_NAME);
                await store.add(project);
            } else {
                project = await store.open(store.projects[0].id);
            }
            showProject();
        },
    };
}

const projectMenu = new Menu();
$('project-menu').onclick = () => {
    projectMenu.open($('project-menu'), [
        { heading: 'Projects' },
        ...store.projects.map(({ id, name }) => ({
            label: name,
            checked: id === project.id,
            run: () => id !== project.id && switchTo(() => store.open(id)),
        })),
        {
            label: '+ New project',
            run: () =>
                switchTo(async () => {
                    const created = store.newProject(DEFAULT_NAME);
                    await store.add(created);
                    return created;
                }),
        },
        null,
        { heading: 'Examples' },
        ...EXAMPLES.map((example) => ({
            label: example.title,
            run: () => switchTo(async () => store.exampleDraft(example)),
        })),
        null,
        project.draft ? closeItem() : deleteItem(),
    ]);
};

let account = null;

function showAccount() {
    const button = $('account');
    button.hidden = false;
    button.classList.toggle('signed-out', !account);
    $('account-name').textContent = account ? account.name : 'Sign in';
    $('account-initial').textContent = account ? account.name.slice(0, 1).toUpperCase() : '';
    button.title = account ? `Signed in as ${account.name}${account.local ? ' (local account)' : ''}` : 'Sign in with Hack Club to keep your projects in the cloud';
}

async function loadAccount() {
    try {
        const response = await fetch('/api/account', { cache: 'no-store' });
        const body = await response.json();
        if (!body.available) return;
        account = body.user;
        showAccount();
    } catch {
    }
}

const SIGN_IN_OUTCOMES = {
    ok: null,
    cancelled: 'Sign-in cancelled.',
    failed: "Couldn't sign in with Hack Club. Try again.",
    unavailable: "Signing in isn't available right now.",
};
{
    const params = new URLSearchParams(location.search);
    const outcome = params.get('signin');
    if (outcome !== null) {
        if (SIGN_IN_OUTCOMES[outcome]) setStatus(SIGN_IN_OUTCOMES[outcome], { hold: 5000 });
        params.delete('signin');
        history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    }
}

function signIn() {
    location.href = '/api/auth/login';
}

async function signInLocally() {
    const email = prompt('Sign in as (any name ending in @local):', 'dev@local');
    if (!email) return;
    const response = await fetch('/api/auth/dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        setStatus(body.message ?? "Couldn't sign in.", { hold: 5000 });
        return;
    }
    account = body.user;
    showAccount();
}

async function signOut(everywhere) {
    await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ everywhere }),
    }).catch(() => {});
    account = null;
    showAccount();
    setStatus(everywhere ? 'Signed out on every device.' : 'Signed out.', { hold: 5000 });
}

const accountMenu = new Menu();
$('account').onclick = () => {
    if (account) {
        accountMenu.open($('account'), [
            { heading: account.local ? `${account.name} (local account)` : account.name },
            { label: 'Sign out', run: () => signOut(false) },
            { label: 'Sign out everywhere', run: () => signOut(true) },
        ]);
    } else if (import.meta.env.DEV) {
        accountMenu.open($('account'), [
            { label: 'Sign in with Hack Club', run: () => signIn() },
            { label: 'Sign in as …@local', run: () => signInLocally() },
        ]);
    } else {
        signIn();
    }
};

loadAccount();

const settingsMenu = new Menu();
$('settings').onclick = () => {
    settingsMenu.open($('settings'), [
        { label: 'Flash physical device…', run: () => openFlash() },
        { label: 'WakaTime…', run: () => openWakatimeSettings() },
        { label: 'Reset panel sizes', run: () => panes.reset() },
    ]);
};

// Flash

function showFlashManual(manual) {
    $('flash-manual').hidden = !manual;
    $('flash-auto').hidden = manual || !('serial' in navigator);
    $('flash-unsupported').hidden = manual || 'serial' in navigator;
    $('flash-manual-toggle').textContent = manual ? 'Back' : 'I want to do this manually';
}

function openFlash() {
    showFlashManual(false);
    $('flash-dialog').showModal();
}

// Uploads the project to the emulated board and returns its drive.
async function projectDrive() {
    const applied = new Promise((resolve) => emulator.addEventListener('files-applied', resolve, { once: true }));
    flash();
    const { detail } = await applied;
    if (detail.errors) throw new Error("The project doesn't fit on the board's drive.");
    return emulator.driveImage();
}

$('flash-manual-toggle').onclick = () => showFlashManual($('flash-manual').hidden);
$('flash-close').onclick = () => $('flash-dialog').close();

$('flash-start').onclick = async () => {
    const status = (text) => ($('flash-status').textContent = text);
    const bar = $('flash-progress').querySelector('progress');
    $('flash-start').disabled = true;
    bar.value = 0;
    status('');
    try {
        const port = await navigator.serial.requestPort();
        $('flash-progress').hidden = false;
        const [{ flashDevice }, drive] = await Promise.all([import('./flash.js'), projectDrive()]);
        await flashDevice(port, drive, { status, progress: (share) => (bar.value = share) });
        status('Done. If the screen stays dark, press RST.');
    } catch (error) {
        // A closed port chooser is a NotFoundError: nothing to report.
        if (error.name !== 'NotFoundError') status(error.message);
    } finally {
        $('flash-start').disabled = false;
    }
};

$('flash-download').onclick = async () => {
    const { flashImage } = await import('./flash.js');
    const image = await flashImage(await projectDrive());
    const link = el('a', { href: URL.createObjectURL(new Blob([image])), download: 'cyd-flash.bin' });
    link.click();
    URL.revokeObjectURL(link.href);
};

for (const block of $('flash-dialog').querySelectorAll('pre')) {
    const copy = el('button', { type: 'button', className: 'copy', textContent: 'Copy' });
    copy.onclick = async () => {
        await navigator.clipboard.writeText(block.textContent);
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1500);
    };
    const wrapper = el('div', { className: 'code' });
    block.before(wrapper);
    wrapper.append(block, copy);
}

$('download').onclick = async () => {
    const zip = new JSZip();
    for (const path of project.folders()) {
        zip.folder(path.slice(1));
    }
    for (const { path, data } of project.list()) {
        zip.file(path.slice(1), data);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const link = el('a', { href: URL.createObjectURL(blob), download: `${project.name.replace(/[\\/:*?"<>|]+/g, '-')}.zip` });
    link.click();
    URL.revokeObjectURL(link.href);
};

showProject();

if (import.meta.env.DEV) {
    window.cyd = { emulator, terminal, store, tree, board, proxy, wakatime, get project() { return project; } };
}
