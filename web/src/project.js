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
    }

    static async load() {
        const project = new Project();
        const saved = await get(STORE_KEY).catch(() => undefined);
        if (saved && saved.length > 0) {
            for (const { path, data } of saved) {
                project.files.set(path, data);
            }
        } else {
            project.loadExample('hello');
        }
        return project;
    }

    async save() {
        await set(STORE_KEY, this.list()).catch(() => {});
    }

    loadExample(id) {
        const settings = this.files.get('/settings.toml');
        this.files.clear();
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
        this.files.set(path, encoder.encode(text));
    }

    write(path, data) {
        this.files.set(path, data);
    }

    remove(path) {
        for (const key of [...this.files.keys()]) {
            if (key === path || key.startsWith(path + '/')) {
                this.files.delete(key);
            }
        }
    }

    rename(from, to) {
        for (const [key, data] of [...this.files.entries()]) {
            if (key === from || key.startsWith(from + '/')) {
                this.files.delete(key);
                this.files.set(to + key.slice(from.length), data);
            }
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
