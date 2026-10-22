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
import { EXAMPLES, Project, normalisePath } from './project.js';
import { BoardView } from './ui/boardView.js';
import { FileTree } from './ui/fileTree.js';
import { initSplitters } from './ui/splitters.js';

const $ = (id) => document.getElementById(id);

if (!crossOriginIsolated) {
    $('status').textContent = 'This page must be served with cross-origin isolation headers (see web/README).';
}

const project = await Project.load();
const emulator = new Emulator({ firmwareUrl: `${import.meta.env.BASE_URL}firmware/circuitpython.mjs` });

let syncedFiles = new Map();
let syncedFolders = new Set();
let openPath = '/code.py';
const unsaved = new Set();

initSplitters($('workspace'));

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
            openPath = project.has('/code.py') ? '/code.py' : project.list()[0]?.path ?? '/code.py';
            reopen();
        }
        changed();
    },
});

function changed() {
    scheduleLocalSave();
    tree.render();
}

const AUTOSAVE_MS = 1000;
let localSaveTimer = 0;
let boardSaveTimer = 0;
function scheduleLocalSave() {
    clearTimeout(localSaveTimer);
    localSaveTimer = setTimeout(() => project.save(), 300);
    clearTimeout(boardSaveTimer);
    boardSaveTimer = setTimeout(() => saveToBoard(), AUTOSAVE_MS);
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
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (run(), true) }]),
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                project.writeText(openPath, update.state.doc.toString());
                if (!unsaved.has(openPath)) {
                    unsaved.add(openPath);
                    tree.render();
                }
                scheduleLocalSave();
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
    syncedFiles = new Map(project.list().map(({ path, data }) => [path, data]));
    syncedFolders = new Set(project.folders());
    unsaved.clear();
    tree.render();
    emulator.start(project.list());
}

function saveToBoard() {
    clearTimeout(boardSaveTimer);
    if (!emulator.powered) {
        return false;
    }
    const ops = [];
    const folders = new Set(project.folders());
    for (const path of syncedFolders) {
        if (!folders.has(path)) ops.push({ kind: 'delete', path });
    }
    for (const path of syncedFiles.keys()) {
        if (!project.has(path) && !ops.some((op) => path.startsWith(op.path + '/'))) {
            ops.push({ kind: 'delete', path });
        }
    }
    for (const path of folders) {
        if (!syncedFolders.has(path)) ops.push({ kind: 'mkdir', path });
    }
    for (const { path, data } of project.list()) {
        if (syncedFiles.get(path) !== data) ops.push({ kind: 'write', path, data });
    }
    syncedFiles = new Map(project.list().map(({ path, data }) => [path, data]));
    syncedFolders = folders;
    unsaved.clear();
    tree.render();
    project.save();
    if (ops.length === 0) {
        return false;
    }
    setStatus('Saving to the board…');
    emulator.applyFiles(ops);
    return true;
}

function run() {
    if (!emulator.powered) {
        project.save();
        setPower(true);
        return;
    }
    if (!saveToBoard()) {
        emulator.sendSerial(new Uint8Array([0x03, 0x04]));
    }
}

emulator.addEventListener('files-applied', (event) => {
    const { errors, saved } = event.detail;
    if (errors) {
        setStatus(`${errors} file(s) could not be written to CIRCUITPY (is the drive full?)`);
    } else if (saved) {
        setStatus('Saved. Auto-reload will restart code.py.');
    } else {
        setStatus('Running');
    }
});

emulator.addEventListener('reset-requested', () => boot());
emulator.addEventListener('state', (event) => setStatus(event.detail.message));

function setStatus(text) {
    $('status').textContent = text;
}

$('run').onclick = () => run();
$('stop').onclick = () => emulator.interrupt();
$('reset').onclick = () => boot();

const board = new BoardView($('board'), emulator, { onReset: () => boot() });

$('flip').onclick = () => {
    const back = board.flip();
    $('flip').setAttribute('aria-pressed', String(back));
    $('flip').title = back ? 'Show the front of the board' : 'Show the back of the board';
};

function setPower(on) {
    if (on) {
        boot();
    } else {
        emulator.powerOff();
    }
    showPower();
}

function showPower() {
    const on = emulator.powered;
    $('power').setAttribute('aria-pressed', String(on));
    $('power-label').textContent = on ? 'On' : 'Off';
    $('stop').disabled = !on;
    $('reset').disabled = !on;
}

$('power').onclick = () => setPower(!emulator.powered);

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

const examples = $('examples');
for (const example of EXAMPLES) {
    const option = document.createElement('option');
    option.value = example.id;
    option.textContent = example.title;
    examples.append(option);
}
examples.onchange = () => {
    const id = examples.value;
    examples.value = '';
    if (!id) return;
    if (!confirm('Replace the files in this project with the example? Your settings.toml is kept.')) return;
    project.loadExample(id);
    project.save();
    editorStates.clear();
    view = null;
    openPath = '/code.py';
    reopen();
    saveToBoard();
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
    link.download = 'CIRCUITPY.zip';
    link.click();
    URL.revokeObjectURL(link.href);
};

openPath = project.has('/code.py') ? '/code.py' : project.list()[0].path;
reopen();
boot();
showPower();

if (import.meta.env.DEV) {
    window.cyd = { emulator, terminal, project, tree, board };
}
