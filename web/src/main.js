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
import { BoardView } from './ui/boardView.js';
import { FileTree } from './ui/fileTree.js';
import { Menu } from './ui/menu.js';
import { initSplitters } from './ui/splitters.js';

const $ = (id) => document.getElementById(id);

if (!crossOriginIsolated) {
    $('status').textContent =
        "The emulator can't start: this page isn't served with cross-origin isolation headers (see Deploying in README.md).";
}

const store = await ProjectStore.load();
let project = await store.openCurrent();
const emulator = new Emulator({ firmwareUrl: `${import.meta.env.BASE_URL}firmware/circuitpython.mjs` });

let boardFiles = null;
let openPath = '/code.py';
const unsaved = new Set();

const panes = initSplitters($('workspace'));

let saveTimer = 0;
function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.save(project), 300);
}

function saveNow() {
    clearTimeout(saveTimer);
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
        for (const path of [...unsaved]) {
            if (path === from || path.startsWith(from + '/')) {
                unsaved.delete(path);
                unsaved.add(to + path.slice(from.length));
            }
        }
        for (const [path, state] of [...editorStates]) {
            if (path === from || path.startsWith(from + '/')) {
                editorStates.delete(path);
                editorStates.set(to + path.slice(from.length), state);
            }
        }
        if (openPath === from || openPath.startsWith(from + '/')) {
            openPath = to + openPath.slice(from.length);
            reopen();
        }
        changed();
    },
    deleted: (path) => {
        project.remove(path);
        for (const key of [...unsaved]) {
            if (key === path || key.startsWith(path + '/')) unsaved.delete(key);
        }
        for (const key of [...editorStates.keys()]) {
            if (key === path || key.startsWith(path + '/')) editorStates.delete(key);
        }
        if (!project.has(openPath)) {
            openPath = firstFile();
            reopen();
        }
        changed();
    },
});

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
        editorHost.innerHTML = '';
        const note = document.createElement('div');
        note.className = 'binary';
        note.textContent = `${openPath.slice(1)} is a binary file (${project.read(openPath).length} bytes). It is copied to the board as is.`;
        editorHost.append(note);
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
}

function boot() {
    if (!boardFiles) {
        flash();
        return;
    }
    emulator.start(boardFiles, project.board.card);
    showPower();
}

function flash() {
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

emulator.addEventListener('reset-requested', () => boot());
emulator.addEventListener('state', (event) => setStatus(event.detail.message));

function setStatus(text) {
    $('status').textContent = text;
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

const boardMenu = new Menu();
$('board-more').onclick = () => {
    const card = project.board.card;
    boardMenu.open($('board-more'), [
        { heading: `microSD card · ${card.inserted ? 'in the slot' : 'not inserted'}` },
        { label: card.inserted ? 'Eject card' : 'Insert card', run: () => setCardInserted(!card.inserted) },
        null,
        { heading: 'Card size' },
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
    ]);
};

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
    boardFiles = null;
    terminal.clear();
    if (!switchedOff) {
        flash();
    }
}

function showName() {
    nameInput.value = project.name;
    document.title = `${project.name} · CYD CircuitPython`;
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

const settingsMenu = new Menu();
$('settings').onclick = () => {
    settingsMenu.open($('settings'), [{ label: 'Reset panel sizes', run: () => panes.reset() }]);
};

$('download').onclick = async () => {
    const zip = new JSZip();
    for (const path of project.folders()) {
        zip.folder(path.slice(1));
    }
    for (const { path, data } of project.list()) {
        zip.file(path.slice(1), data);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${project.name.replace(/[\\/:*?"<>|]+/g, '-')}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
};

showProject();

if (import.meta.env.DEV) {
    window.cyd = { emulator, terminal, store, tree, board, get project() { return project; } };
}
