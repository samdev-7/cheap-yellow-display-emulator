import { del, get, set } from 'idb-keyval';

import settingsTemplate from './examples/settings.toml?raw';
import starterCode from './templates/code.py?raw';

//
export const FORMAT_VERSION = 1;
const INDEX_KEY = 'cyd-projects-v1';
const projectKey = (id) => `cyd-project:${id}`;
const OLD_FILES_KEY = 'cyd-project-v1';
const OLD_CARD_KEY = 'cyd-sdcard-v1';

function upgrade(saved) {
    const version = saved.version ?? 1;
    if (version > FORMAT_VERSION) {
        return null;
    }
    const board = defaultBoardState();
    return {
        ...saved,
        version: FORMAT_VERSION,
        files: saved.files ?? [],
        folders: saved.folders ?? [],
        board: {
            ...board,
            ...saved.board,
            card: { ...board.card, ...saved.board?.card },
            wifi: { ...board.wifi, ...saved.board?.wifi },
        },
    };
}

export const DEFAULT_NAME = 'Untitled project';
const DEFAULT_EXAMPLE = 'hello';

const exampleSources = import.meta.glob('./examples/*/**/*', { query: '?raw', import: 'default', eager: true });
const librarySources = import.meta.glob('./library/**/*.py', { query: '?raw', import: 'default', eager: true });

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const EXAMPLES = [
    { id: 'hello', title: 'Hello, CYD!' },
    { id: 'touch-paint', title: 'Touch paint' },
    { id: 'bouncy-balls', title: 'Bouncy balls' },
    { id: '3d-shapes', title: '3D shapes' },
    { id: 'rgb-led', title: 'RGB LED colour wheel' },
    { id: 'light-sensor', title: 'Light sensor' },
    { id: 'boot-button', title: 'BOOT button and backlight' },
    { id: 'sd-card', title: 'microSD card' },
    { id: 'wifi', title: 'Wi-Fi and the internet' },
    { id: 'weather', title: 'Weather' },
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

export function defaultBoardState() {
    return {
        side: 'front',
        light: 70,
        card: { inserted: false, sizeGB: 8, sectors: 0, blocks: new Map() },
        wifi: { inRange: true, passwordAccepted: true, internet: true, connectInstantly: true },
        nvm: null, // microcontroller.nvm contents, or null if blank.
    };
}

export class Project {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.files = new Map(); // path -> Uint8Array
        this.emptyFolders = new Set();
        this.board = defaultBoardState();
    }

    static fromExample(id, name, exampleId) {
        return Project.withFiles(id, name, exampleFiles(exampleId));
    }

    static starter(id, name) {
        return Project.withFiles(id, name, [{ path: '/code.py', data: encoder.encode(starterCode) }]);
    }

    static withFiles(id, name, files) {
        const project = new Project(id, name);
        project.emptyFolders.add('/lib');
        project.files.set('/settings.toml', encoder.encode(settingsTemplate));
        for (const file of libraryFiles()) {
            project.files.set(file.path, file.data);
        }
        for (const file of files) {
            project.files.set(file.path, file.data);
        }
        return project;
    }

    static fromSaved(id, saved) {
        const upgraded = upgrade(saved);
        if (!upgraded) {
            const project = Project.fromSaved(id, { ...saved, version: FORMAT_VERSION });
            project.newerFormat = true;
            return project;
        }
        const project = new Project(id, upgraded.name);
        for (const { path, data } of upgraded.files) {
            project.files.set(path, data);
        }
        for (const path of upgraded.folders) {
            project.emptyFolders.add(path);
        }
        project.board = upgraded.board;
        return project;
    }

    toSaved() {
        return {
            version: FORMAT_VERSION,
            name: this.name,
            files: this.list(),
            folders: this.folders(),
            board: this.board,
        };
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

export class ProjectStore {
    constructor() {
        this.projects = []; // [{ id, name }]
        this.currentId = null;
        this.seeded = false;
    }

    static async load() {
        const store = new ProjectStore();
        const index = await get(INDEX_KEY).catch(() => undefined);
        if (index) {
            store.projects = index.projects ?? [];
            store.currentId = index.currentId;
            store.seeded = index.seeded ?? true;
            store.newerFormat = (index.version ?? 1) > FORMAT_VERSION;
        }
        if (store.projects.length === 0) {
            await store.migrate();
        }
        return store;
    }

    async migrate() {
        const oldFiles = await get(OLD_FILES_KEY).catch(() => undefined);
        const files = Array.isArray(oldFiles) ? oldFiles : oldFiles?.files;
        let project;
        if (files && files.length > 0) {
            project = Project.fromSaved(newId(), { name: DEFAULT_NAME, files, folders: oldFiles.folders ?? [] });
            const oldCard = await get(OLD_CARD_KEY).catch(() => undefined);
            if (oldCard) {
                project.board.card = oldCard;
            }
        } else if (!this.seeded) {
            project = Project.fromExample(newId(), DEFAULT_NAME, DEFAULT_EXAMPLE);
        } else {
            project = Project.starter(newId(), DEFAULT_NAME);
        }
        this.seeded = true;
        await this.add(project);
    }

    async open(id) {
        const saved = await get(projectKey(id)).catch(() => undefined);
        this.currentId = id;
        await this.saveIndex();
        if (!saved) {
            return Project.starter(id, this.nameOf(id) ?? DEFAULT_NAME);
        }
        return Project.fromSaved(id, saved);
    }

    async openCurrent() {
        const id = this.projects.some((p) => p.id === this.currentId) ? this.currentId : this.projects[0].id;
        return this.open(id);
    }

    async add(project) {
        project.draft = false;
        project.name = this.uniqueName(project.name);
        this.projects.push({ id: project.id, name: project.name });
        this.currentId = project.id;
        await this.save(project);
    }

    async save(project) {
        if (project.newerFormat || project.draft) {
            return;
        }
        const entry = this.projects.find((p) => p.id === project.id);
        if (entry) {
            entry.name = project.name;
        }
        await Promise.all([set(projectKey(project.id), project.toSaved()), this.saveIndex()]).catch(() => {});
    }

    async remove(id) {
        this.projects = this.projects.filter((p) => p.id !== id);
        await del(projectKey(id)).catch(() => {});
        await this.saveIndex();
    }

    saveIndex() {
        if (this.newerFormat) {
            return Promise.resolve();
        }
        return set(INDEX_KEY, {
            version: FORMAT_VERSION,
            projects: this.projects,
            currentId: this.currentId,
            seeded: this.seeded,
        }).catch(() => {});
    }

    nameOf(id) {
        return this.projects.find((p) => p.id === id)?.name;
    }

    uniqueName(base) {
        const names = new Set(this.projects.map((p) => p.name));
        if (!names.has(base)) return base;
        for (let n = 1; ; n++) {
            if (!names.has(`${base} [${n}]`)) return `${base} [${n}]`;
        }
    }

    newProject(name) {
        return Project.starter(newId(), this.uniqueName(name));
    }

    exampleDraft(example) {
        const project = Project.fromExample(newId(), example.title, example.id);
        project.draft = true;
        return project;
    }
}

function newId() {
    return crypto.randomUUID();
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
