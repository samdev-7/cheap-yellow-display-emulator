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
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './emulator/shared.js';
import { EXAMPLES, Project, normalisePath } from './project.js';

const $ = (id) => document.getElementById(id);

if (!crossOriginIsolated) {
    $('status').textContent = 'This page must be served with cross-origin isolation headers (see web/README).';
}

const project = await Project.load();
const emulator = new Emulator({ firmwareUrl: `${import.meta.env.BASE_URL}firmware/circuitpython.mjs` });

let synced = new Map();
let openPath = '/code.py';
const unsaved = new Set();

const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
const editorHost = $('editor');
const editorStates = new Map();
let view = null;

function editorState(path, text) {
    const extensions = [
        basicSetup,
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (saveAndRun(), true) }]),
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                project.writeText(path, update.state.doc.toString());
                if (!unsaved.has(path)) {
                    unsaved.add(path);
                    renderFiles();
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
    if (view) {
        editorStates.set(openPath, view.state);
    }
    openPath = path;
    $('editor-title').textContent = path.slice(1);
    const text = project.readText(path);
    if (text === null) {
        view?.destroy();
        view = null;
        editorHost.innerHTML = '';
        const note = document.createElement('div');
        note.className = 'binary';
        note.textContent = `${path.slice(1)} is a binary file (${project.read(path).length} bytes). It is copied to the board as is.`;
        editorHost.append(note);
    } else {
        const state = editorStates.get(path) ?? editorState(path, text);
        if (view) {
            view.setState(state);
        } else {
            editorHost.innerHTML = '';
            view = new EditorView({ state, parent: editorHost });
        }
        view.focus();
    }
    renderFiles();
}

function renderFiles() {
    const list = $('file-list');
    list.innerHTML = '';
    let folder = '';
    for (const { path } of project.list()) {
        const dir = path.slice(0, path.lastIndexOf('/'));
        if (dir !== folder && dir) {
            const heading = document.createElement('li');
            heading.className = 'folder';
            heading.textContent = dir.slice(1) + '/';
            list.append(heading);
        }
        folder = dir;
        const item = document.createElement('li');
        const button = document.createElement('button');
        const name = dir ? path.slice(dir.length + 1) : path.slice(1);
        button.textContent = (dir ? '  ' : '') + name;
        if (unsaved.has(path)) {
            const mark = document.createElement('span');
            mark.className = 'dirty';
            mark.textContent = ' ●';
            mark.title = 'Not yet saved to the board';
            button.append(mark);
        }
        button.title = path.slice(1);
        button.setAttribute('aria-current', path === openPath ? 'true' : 'false');
        button.onclick = () => openFile(path);
        item.append(button);
        list.append(item);
    }
}

let localSaveTimer = 0;
function scheduleLocalSave() {
    clearTimeout(localSaveTimer);
    localSaveTimer = setTimeout(() => project.save(), 500);
}

$('new-file').onclick = () => {
    const name = prompt('New file name (for example helpers.py or lib/mylib.py):', 'new.py');
    const path = name && normalisePath(name);
    if (!path) return;
    if (!project.has(path)) {
        project.writeText(path, '');
        unsaved.add(path);
        scheduleLocalSave();
    }
    openFile(path);
};

$('upload').onclick = () => $('upload-input').click();
$('upload-input').onchange = async (event) => {
    for (const file of event.target.files) {
        const inLib = /\.mpy$/.test(file.name) ? '/lib/' : '/';
        const path = normalisePath(inLib + file.name);
        project.write(path, new Uint8Array(await file.arrayBuffer()));
        unsaved.add(path);
    }
    event.target.value = '';
    scheduleLocalSave();
    renderFiles();
};

$('rename-file').onclick = () => {
    const name = prompt('Rename to:', openPath.slice(1));
    const path = name && normalisePath(name);
    if (!path || path === openPath) return;
    if (project.has(path)) {
        alert(`${path.slice(1)} already exists.`);
        return;
    }
    project.rename(openPath, path);
    editorStates.delete(openPath);
    unsaved.add(path);
    unsaved.delete(openPath);
    scheduleLocalSave();
    view = null;
    openFile(path);
};

$('delete-file').onclick = () => {
    if (!confirm(`Delete ${openPath.slice(1)}?`)) return;
    project.remove(openPath);
    editorStates.delete(openPath);
    unsaved.delete(openPath);
    scheduleLocalSave();
    view = null;
    openFile(project.has('/code.py') ? '/code.py' : project.list()[0]?.path ?? '/code.py');
};

function boot() {
    synced = new Map(project.list().map(({ path, data }) => [path, data]));
    unsaved.clear();
    renderFiles();
    emulator.start(project.list());
}

function saveAndRun() {
    const ops = [];
    for (const { path, data } of project.list()) {
        if (synced.get(path) !== data) {
            ops.push({ kind: 'write', path, data });
        }
    }
    for (const path of synced.keys()) {
        if (!project.has(path)) {
            ops.push({ kind: 'delete', path });
        }
    }
    synced = new Map(project.list().map(({ path, data }) => [path, data]));
    unsaved.clear();
    renderFiles();
    project.save();
    if (ops.length === 0) {
        emulator.sendSerial(new Uint8Array([0x03, 0x04]));
        return;
    }
    setStatus('Saving to the board…');
    emulator.applyFiles(ops);
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

$('run').onclick = () => saveAndRun();
$('stop').onclick = () => emulator.interrupt();
$('reset').onclick = () => boot();
$('rst-button').onclick = () => boot();

const bootButton = $('boot-button');
const pressBoot = (pressed) => {
    bootButton.classList.toggle('pressed', pressed);
    emulator.setBootButton(pressed);
};
bootButton.addEventListener('pointerdown', () => pressBoot(true));
bootButton.addEventListener('pointerup', () => pressBoot(false));
bootButton.addEventListener('pointerleave', () => pressBoot(false));

const light = $('light');
const updateLight = () => emulator.setLightSensorMillivolts(50 + (1 - light.value / 100) * 1200);
light.oninput = updateLight;
updateLight();

const canvas = $('screen');
const touchAt = (event, pressed) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * SCREEN_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * SCREEN_HEIGHT;
    emulator.setTouch(pressed, Math.min(SCREEN_WIDTH - 1, Math.max(0, x)), Math.min(SCREEN_HEIGHT - 1, Math.max(0, y)));
};
let touching = false;
canvas.addEventListener('pointerdown', (event) => {
    touching = true;
    canvas.setPointerCapture(event.pointerId);
    touchAt(event, true);
});
canvas.addEventListener('pointermove', (event) => {
    if (touching) touchAt(event, true);
});
const release = (event) => {
    touching = false;
    touchAt(event, false);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

const context = canvas.getContext('2d');
const image = context.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
const led = $('led');
const screenOff = $('screen-off');
let lastFrame = -1;
function render() {
    const frame = emulator.frameCounter();
    if (frame !== lastFrame) {
        lastFrame = frame;
        image.data.set(emulator.framebuffer);
        context.putImageData(image, 0, 0);
        const out = emulator.outputs();
        const level = out.displayOn ? out.backlight : 0;
        screenOff.style.opacity = String(1 - level);
        const r = Math.round(out.red * 255);
        const g = Math.round(out.green * 255);
        const b = Math.round(out.blue * 255);
        const lit = r + g + b > 0;
        led.style.background = lit ? `rgb(${r} ${g} ${b})` : '#f6f3e6';
        led.style.boxShadow = lit ? `0 0 10px 3px rgb(${r} ${g} ${b} / 0.8)` : 'none';
    }
    requestAnimationFrame(render);
}
requestAnimationFrame(render);

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
    openFile('/code.py');
    saveAndRun();
};

$('download').onclick = async () => {
    const zip = new JSZip();
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

openFile(project.has('/code.py') ? '/code.py' : project.list()[0].path);
boot();

if (import.meta.env.DEV) {
    window.cyd = { emulator, terminal, project };
}
