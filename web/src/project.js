import { get, set } from 'idb-keyval';

const STORE_KEY = 'cyd-project-v1';

const exampleSources = import.meta.glob('./examples/**/*', { query: '?raw', import: 'default', eager: true });
const librarySources = import.meta.glob('./library/**/*.py', { query: '?raw', import: 'default', eager: true });

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const EXAMPLES = [
    { id: 'hello', title: 'Hello, CYD! (text on screen)' },
    { id: 'touch-paint', title: 'Touch paint' },
    { id: 'rgb-led', title: 'RGB LED colour wheel' },
    { id: 'light-sensor', title: 'Light sensor' },
    { id: 'boot-button', title: 'BOOT button and backlight' },
];

export function libraryFiles() {
    const files = [];
    for (const [source, text] of Object.entries(librarySources)) {
        const [, name, file] = source.match(/^\.\/library\/([^/]+)\/(.+)$/);
        const path = file === `${name}.py` ? `/lib/${file}` : `/lib/${name}/${file}`;
        files.push({ path, data: encoder.encode(text) });
    }
    return files;
}

export function exampleFiles(id) {
    const prefix = `./examples/${id}/`;
    const files = [];
    for (const [source, text] of Object.entries(exampleSources)) {
        if (source.startsWith(prefix)) {
            files.push({ path: '/' + source.slice(prefix.length), data: encoder.encode(text) });
        }
    }
    return files;
}

export class Project {
    constructor() {
        this.files = new Map(); // path -> Uint8Array
        this.emptyFolders = new Set(); // Folders with nothing in them yet, like lib/ on a new board.
    }

    static async load() {
        const project = new Project();
        const saved = await get(STORE_KEY).catch(() => undefined);
        const files = Array.isArray(saved) ? saved : saved?.files;
        if (files && files.length > 0) {
            for (const { path, data } of files) {
                project.files.set(path, data);
            }
            for (const path of saved.folders ?? []) {
                project.emptyFolders.add(path);
            }
        } else {
            project.loadExample('hello');
        }
        return project;
    }

    async save() {
        await set(STORE_KEY, { files: this.list(), folders: this.folders() }).catch(() => {});
    }

    folders() {
        const all = new Set(this.emptyFolders);
        for (const path of this.files.keys()) {
            for (let i = path.indexOf('/', 1); i > 0; i = path.indexOf('/', i + 1)) {
                all.add(path.slice(0, i));
            }
        }
        return [...all].sort((a, b) => a.localeCompare(b));
    }

    isFolder(path) {
        return this.folders().includes(path);
    }

    exists(path) {
        return this.files.has(path) || this.isFolder(path);
    }

    mkdir(path) {
        if (!this.exists(path)) {
            this.emptyFolders.add(path);
        }
    }

    loadExample(id) {
        const settings = this.files.get('/settings.toml');
        this.files.clear();
        this.emptyFolders = new Set(['/lib']);
        this.files.set('/settings.toml', settings ?? encoder.encode(''));
        for (const file of libraryFiles()) {
            this.files.set(file.path, file.data);
        }
        for (const file of exampleFiles(id)) {
            this.files.set(file.path, file.data);
        }
    }

    list() {
        return [...this.files.entries()]
            .sort(([a], [b]) => comparePaths(a, b))
            .map(([path, data]) => ({ path, data }));
    }

    has(path) {
        return this.files.has(path);
    }

    read(path) {
        return this.files.get(path);
    }

    readText(path) {
        try {
            return decoder.decode(this.files.get(path));
        } catch {
            return null;
        }
    }

    writeText(path, text) {
        this.write(path, encoder.encode(text));
    }

    write(path, data) {
        this.files.set(path, data);
        this.emptyFolders.delete(path.slice(0, path.lastIndexOf('/')));
    }

    remove(path) {
        const inside = (key) => key === path || key.startsWith(path + '/');
        for (const key of [...this.files.keys()]) {
            if (inside(key)) {
                this.files.delete(key);
            }
        }
        for (const key of [...this.emptyFolders]) {
            if (inside(key)) {
                this.emptyFolders.delete(key);
            }
        }
        this.keepParent(path);
    }

    rename(from, to) {
        const inside = (key) => key === from || key.startsWith(from + '/');
        for (const [key, data] of [...this.files.entries()]) {
            if (inside(key)) {
                this.files.delete(key);
                this.files.set(to + key.slice(from.length), data);
            }
        }
        for (const key of [...this.emptyFolders]) {
            if (inside(key)) {
                this.emptyFolders.delete(key);
                this.emptyFolders.add(to + key.slice(from.length));
            }
        }
        this.keepParent(from);
    }

    keepParent(path) {
        const parent = path.slice(0, path.lastIndexOf('/'));
        if (parent && !this.exists(parent)) {
            this.emptyFolders.add(parent);
        }
    }
}

function comparePaths(a, b) {
    const rank = (p) => (p === '/code.py' ? 0 : p.split('/').length > 2 ? 2 : 1);
    return rank(a) - rank(b) || a.localeCompare(b);
}

export function normalisePath(input) {
    const parts = input.trim().replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
    if (parts.length === 0 || parts.includes('..')) {
        return null;
    }
    return '/' + parts.join('/');
}
