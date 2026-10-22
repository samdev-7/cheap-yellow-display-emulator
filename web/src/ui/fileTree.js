const COLLAPSED_KEY = 'cyd-tree-collapsed';

const PINNED = ['/code.py'];

const ICONS = {
    folder:
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5h4.2l1.4 1.6h7.4v7.9h-13z" fill="var(--folder)"/></svg>',
    folderOpen:
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5h4.2l1.4 1.6h6.4v1.6H4.2L1.5 13z" fill="var(--folder)"/><path d="M4.2 6.7h11l-2.6 6.3H1.5z" fill="var(--folder-open)"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    more: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="12.5" cy="8" r="1.4" fill="currentColor"/></svg>',
};

const FILE_COLOURS = {
    py: '#3b7bbf',
    mpy: '#8a5cc7',
    toml: '#8c8c8c',
    txt: '#8c8c8c',
    json: '#c78a2b',
    bmp: '#3fa66a',
    png: '#3fa66a',
    jpg: '#3fa66a',
    gif: '#3fa66a',
    bdf: '#c7584d',
    pcf: '#c7584d',
    wav: '#d16aa0',
    mp3: '#d16aa0',
};

function fileIcon(name) {
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const band = FILE_COLOURS[ext] ?? '#8c8c8c';
    return (
        '<svg viewBox="0 0 16 16" aria-hidden="true">' +
        '<path d="M3 1.5h6.5L13 5v9.5H3z" fill="var(--file)"/>' +
        '<path d="M9.5 1.5V5H13z" fill="var(--file-fold)"/>' +
        `<rect x="3" y="10.5" width="10" height="4" fill="${band}"/>` +
        '</svg>'
    );
}

const baseName = (path) => path.slice(path.lastIndexOf('/') + 1);
const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));

const DRAG_TYPE = 'application/x-circuitpy-path';
const OPEN_ON_HOVER_MS = 600;

export class FileTree {
    constructor(host, project, callbacks) {
        this.host = host;
        this.project = project;
        this.cb = callbacks;
        this.collapsed = new Set(loadCollapsed());
        this.editing = null; // { mode: 'rename' | 'file' | 'folder', path }
        this.selected = '';
        this.dragging = null;
        this.menu = new Menu();
        host.classList.add('tree');
        host.setAttribute('role', 'tree');
        host.setAttribute('aria-label', 'Files on the CIRCUITPY drive');

        host.addEventListener('click', (event) => {
            if (!event.target.closest('.tree-row')) {
                this.select('');
            }
        });
        this.dropZone(host, () => '');
        const endDrag = () => {
            this.dragging = null;
            this.highlight(null);
        };
        document.addEventListener('dragend', endDrag);
        document.addEventListener('drop', endDrag);
    }

    targetFolder() {
        if (!this.selected) return '';
        return this.project.isFolder(this.selected) ? this.selected : parentOf(this.selected);
    }

    select(path) {
        this.selected = path;
        for (const row of this.host.querySelectorAll('.tree-row')) {
            row.classList.toggle('selected', row.dataset.path === path);
        }
    }

    move(from, folder) {
        const to = `${folder}/${baseName(from)}`;
        if (to === from) return null;
        if (folder === from || folder.startsWith(from + '/')) {
            return `Can't move ${baseName(from)} into itself.`;
        }
        if (this.project.exists(to)) {
            return `${folder ? folder.slice(1) : 'The top folder'} already has ${baseName(from)}.`;
        }
        if (this.collapsed.delete(from)) this.collapsed.add(to);
        if (folder) this.collapsed.delete(folder);
        saveCollapsed(this.collapsed);
        if (this.selected === from || this.selected.startsWith(from + '/')) {
            this.selected = to + this.selected.slice(from.length);
        }
        this.cb.renamed(from, to);
        return null;
    }

    dropZone(element, folderFor) {
        let openTimer = 0;
        const accepts = (event) =>
            event.dataTransfer.types.includes(DRAG_TYPE) || event.dataTransfer.types.includes('Files');
        element.addEventListener('dragover', (event) => {
            if (!accepts(event)) return;
            event.stopPropagation();
            const folder = folderFor();
            if (this.dragging && (folder === this.dragging || folder.startsWith(this.dragging + '/'))) {
                event.dataTransfer.dropEffect = 'none';
                return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = this.dragging ? 'move' : 'copy';
            this.highlight(folder);
            if (folder && this.collapsed.has(folder) && !openTimer) {
                openTimer = setTimeout(() => {
                    openTimer = 0;
                    this.collapsed.delete(folder);
                    this.render();
                    this.highlight(folder);
                }, OPEN_ON_HOVER_MS);
            }
        });
        element.addEventListener('dragleave', (event) => {
            if (!element.contains(event.relatedTarget)) {
                clearTimeout(openTimer);
                openTimer = 0;
            }
        });
        element.addEventListener('drop', (event) => {
            if (!accepts(event)) return;
            event.preventDefault();
            event.stopPropagation();
            clearTimeout(openTimer);
            openTimer = 0;
            this.highlight(null);
            const folder = folderFor();
            const from = event.dataTransfer.getData(DRAG_TYPE);
            this.dragging = null;
            if (from) {
                const error = this.move(from, folder);
                if (error) this.cb.notify(error);
            } else if (event.dataTransfer.files.length > 0) {
                if (folder) this.collapsed.delete(folder);
                this.cb.dropped(folder, [...event.dataTransfer.files]);
            }
        });
    }

    highlight(folder) {
        this.host.classList.toggle('drop-root', folder === '');
        for (const row of this.host.querySelectorAll('.tree-row')) {
            row.classList.toggle('drop-target', folder !== null && folder !== '' && row.dataset.path === folder);
        }
    }

    render() {
        const pinned = PINNED.filter((path) => this.project.has(path));
        const tree = buildTree(this.project, pinned);
        this.host.innerHTML = '';
        for (const path of pinned) {
            this.host.append(this.renderNode({ path, name: baseName(path), children: null }, 0));
        }
        if (pinned.length > 0) {
            const divider = document.createElement('li');
            divider.className = 'tree-divider';
            divider.setAttribute('role', 'separator');
            this.host.append(divider);
        }
        if (this.editing && this.editing.mode !== 'rename' && this.editing.path === '') {
            this.host.append(this.editingRow(this.editing, 0));
        }
        this.renderChildren(tree, this.host, 0);
    }

    renderChildren(node, list, depth) {
        for (const child of node.children) {
            list.append(this.renderNode(child, depth));
        }
    }

    renderNode(node, depth) {
        const item = document.createElement('li');
        item.setAttribute('role', 'treeitem');
        const isFolder = node.children !== null;
        const open = isFolder && !this.collapsed.has(node.path);
        if (isFolder) {
            item.setAttribute('aria-expanded', String(open));
        }

        if (this.editing?.mode === 'rename' && this.editing.path === node.path) {
            item.append(this.editingRow(this.editing, depth, isFolder));
        } else {
            item.append(this.row(node, depth, isFolder, open));
        }

        if (isFolder && open) {
            const group = document.createElement('ul');
            group.setAttribute('role', 'group');
            if (this.editing && this.editing.mode !== 'rename' && this.editing.path === node.path) {
                group.append(this.editingRow(this.editing, depth + 1));
            }
            this.renderChildren(node, group, depth + 1);
            item.append(group);
        }
        return item;
    }

    row(node, depth, isFolder, open) {
        const row = document.createElement('div');
        row.className = 'tree-row';
        row.dataset.path = node.path;
        row.style.setProperty('--depth', depth);
        row.tabIndex = 0;
        if (node.path === this.selected) {
            row.classList.add('selected');
        }
        row.draggable = true;
        row.addEventListener('dragstart', (event) => {
            this.dragging = node.path;
            event.dataTransfer.setData(DRAG_TYPE, node.path);
            event.dataTransfer.setData('text/plain', node.path.slice(1));
            event.dataTransfer.effectAllowed = 'move';
            row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => {
            this.dragging = null;
            row.classList.remove('dragging');
            this.highlight(null);
        });
        this.dropZone(row, () => (isFolder ? node.path : parentOf(node.path)));
        const current = !isFolder && node.path === this.cb.openPath();
        if (current) {
            row.classList.add('current');
            row.setAttribute('aria-current', 'true');
        }
        row.title = node.path.slice(1);

        const chevron = document.createElement('span');
        chevron.className = 'tree-chevron' + (open ? ' open' : '');
        chevron.innerHTML = isFolder ? ICONS.chevron : '';
        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.innerHTML = isFolder ? (open ? ICONS.folderOpen : ICONS.folder) : fileIcon(node.name);
        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = node.name;
        row.append(chevron, icon, name);

        if (!isFolder && this.cb.isUnsaved(node.path)) {
            const dot = document.createElement('span');
            dot.className = 'tree-unsaved';
            dot.title = 'Not saved to the board yet';
            row.append(dot);
        }

        const more = document.createElement('button');
        more.className = 'tree-more';
        more.innerHTML = ICONS.more;
        more.title = 'More actions';
        more.setAttribute('aria-label', `Actions for ${node.name}`);
        more.setAttribute('aria-haspopup', 'menu');
        more.addEventListener('click', (event) => {
            event.stopPropagation();
            this.openMenu(more, node.path, isFolder);
        });
        row.append(more);

        const activate = () => {
            this.select(node.path);
            if (isFolder) {
                this.toggle(node.path);
            } else {
                this.cb.open(node.path);
            }
        };
        row.addEventListener('click', activate);
        row.addEventListener('keydown', (event) => {
            if (event.target !== row) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activate();
            } else if (event.key === 'ArrowRight' && isFolder && !open) {
                this.toggle(node.path);
            } else if (event.key === 'ArrowLeft' && isFolder && open) {
                this.toggle(node.path);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const rows = [...this.host.querySelectorAll('.tree-row')];
                rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
            } else if (event.key === 'F2') {
                this.startRename(node.path);
            } else if (event.key === 'Delete') {
                this.remove(node.path, isFolder);
            }
        });
        row.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.openMenu(more, node.path, isFolder);
        });
        return row;
    }

    editingRow(editing, depth, isFolder = editing.mode === 'folder') {
        const row = document.createElement('div');
        row.className = 'tree-row editing';
        row.style.setProperty('--depth', depth);
        const chevron = document.createElement('span');
        chevron.className = 'tree-chevron';
        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        const input = document.createElement('input');
        input.className = 'tree-input';
        input.spellcheck = false;
        input.setAttribute('aria-label', editing.mode === 'rename' ? 'New name' : `Name of the new ${editing.mode}`);
        const initial = editing.mode === 'rename' ? baseName(editing.path) : '';
        input.value = initial;
        icon.innerHTML = isFolder ? ICONS.folder : fileIcon(initial || 'x.py');
        input.addEventListener('input', () => {
            if (!isFolder) icon.innerHTML = fileIcon(input.value || 'x.py');
            input.setCustomValidity('');
            input.title = '';
        });
        row.append(chevron, icon, input);

        let done = false;
        const finish = (commit) => {
            if (done) return;
            if (commit) {
                const error = this.commit(editing, input.value.trim());
                if (error) {
                    input.setCustomValidity(error);
                    input.title = error;
                    input.reportValidity();
                    return;
                }
            }
            done = true;
            this.editing = null;
            this.render();
        };
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                finish(true);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                finish(false);
            }
        });
        input.addEventListener('blur', () => {
            if (input.value.trim() && !this.check(editing, input.value.trim())) {
                finish(true);
            } else {
                finish(false);
            }
        });
        setTimeout(() => {
            input.focus();
            const dot = initial.lastIndexOf('.');
            input.setSelectionRange(0, dot > 0 ? dot : initial.length);
        });
        return row;
    }

    check(editing, name) {
        if (!name) return 'Enter a name.';
        if (name.includes('/') || name.includes('\\')) return 'Names cannot contain / or \\.';
        if (name === '.' || name === '..') return 'That name is reserved.';
        const folder = editing.mode === 'rename' ? parentOf(editing.path) : editing.path;
        const path = `${folder}/${name}`;
        if (editing.mode === 'rename' && path === editing.path) return null;
        if (this.project.exists(path)) return `${name} already exists here.`;
        return null;
    }

    commit(editing, name) {
        const error = this.check(editing, name);
        if (error) return error;
        if (editing.mode === 'rename') {
            const to = `${parentOf(editing.path)}/${name}`;
            if (to !== editing.path) {
                if (this.collapsed.delete(editing.path)) this.collapsed.add(to);
                this.cb.renamed(editing.path, to);
            }
        } else {
            const path = `${editing.path}/${name}`;
            this.cb.created(path, editing.mode);
        }
        return null;
    }

    startCreate(kind, folder = this.targetFolder()) {
        if (folder) {
            this.collapsed.delete(folder);
            saveCollapsed(this.collapsed);
        }
        this.editing = { mode: kind, path: folder };
        this.render();
    }

    startRename(path) {
        this.editing = { mode: 'rename', path };
        this.render();
    }

    remove(path, isFolder) {
        const what = isFolder ? `the folder ${path.slice(1)} and everything in it` : path.slice(1);
        if (confirm(`Delete ${what}?`)) {
            this.cb.deleted(path);
        }
    }

    toggle(path) {
        if (!this.collapsed.delete(path)) {
            this.collapsed.add(path);
        }
        saveCollapsed(this.collapsed);
        this.render();
        this.host.querySelector(`.tree-row[title="${CSS.escape(path.slice(1))}"]`)?.focus();
    }

    reveal(path) {
        for (let folder = parentOf(path); folder; folder = parentOf(folder)) {
            this.collapsed.delete(folder);
        }
        saveCollapsed(this.collapsed);
    }

    openMenu(anchor, path, isFolder) {
        const items = [];
        if (isFolder) {
            items.push({ label: 'New file', run: () => this.startCreate('file', path) });
            items.push({ label: 'New folder', run: () => this.startCreate('folder', path) });
            items.push(null);
        }
        items.push({ label: 'Rename', run: () => this.startRename(path) });
        items.push({ label: 'Delete', danger: true, run: () => this.remove(path, isFolder) });
        this.menu.open(anchor, items);
    }
}

function buildTree(project, pinned) {
    const root = { path: '', name: '', children: [] };
    const folders = new Map([['', root]]);
    const folderNode = (path) => {
        if (folders.has(path)) return folders.get(path);
        const node = { path, name: baseName(path), children: [] };
        folders.set(path, node);
        folderNode(parentOf(path)).children.push(node);
        return node;
    };
    for (const path of project.folders()) {
        folderNode(path);
    }
    for (const { path } of project.list()) {
        if (pinned.includes(path)) continue;
        folderNode(parentOf(path)).children.push({ path, name: baseName(path), children: null });
    }
    const sort = (node) => {
        node.children.sort((a, b) => {
            const folderFirst = (b.children !== null) - (a.children !== null);
            return folderFirst || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });
        node.children.forEach((child) => child.children && sort(child));
    };
    sort(root);
    return root;
}

class Menu {
    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'menu';
        this.element.setAttribute('role', 'menu');
        this.element.hidden = true;
        document.body.append(this.element);
        this.anchor = null;
        document.addEventListener('pointerdown', (event) => {
            if (!this.element.hidden && !this.element.contains(event.target) && event.target.closest('.tree-more') !== this.anchor) {
                this.close();
            }
        });
        this.element.addEventListener('keydown', (event) => {
            const buttons = [...this.element.querySelectorAll('button')];
            const index = buttons.indexOf(document.activeElement);
            if (event.key === 'Escape') {
                event.preventDefault();
                this.close(true);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                buttons[(index + step + buttons.length) % buttons.length].focus();
            } else if (event.key === 'Tab') {
                this.close();
            }
        });
        window.addEventListener('resize', () => this.close());
        window.addEventListener('blur', () => this.close());
    }

    open(anchor, items) {
        if (this.anchor === anchor && !this.element.hidden) {
            this.close();
            return;
        }
        this.anchor?.classList.remove('open');
        this.anchor = anchor;
        anchor.classList.add('open');
        anchor.setAttribute('aria-expanded', 'true');
        this.element.innerHTML = '';
        for (const item of items) {
            if (!item) {
                const separator = document.createElement('div');
                separator.className = 'menu-separator';
                separator.setAttribute('role', 'separator');
                this.element.append(separator);
                continue;
            }
            const button = document.createElement('button');
            button.setAttribute('role', 'menuitem');
            button.textContent = item.label;
            if (item.danger) button.classList.add('danger');
            button.addEventListener('click', () => {
                this.close();
                item.run();
            });
            this.element.append(button);
        }
        this.element.hidden = false;
        const rect = anchor.getBoundingClientRect();
        const menu = this.element.getBoundingClientRect();
        const left = Math.min(rect.right - menu.width, window.innerWidth - menu.width - 8);
        const below = rect.bottom + 4;
        const top = below + menu.height > window.innerHeight - 8 ? rect.top - menu.height - 4 : below;
        this.element.style.left = `${Math.max(8, left)}px`;
        this.element.style.top = `${Math.max(8, top)}px`;
        this.element.querySelector('button')?.focus();
    }

    close(returnFocus = false) {
        if (this.element.hidden) return;
        this.element.hidden = true;
        this.anchor?.classList.remove('open');
        this.anchor?.setAttribute('aria-expanded', 'false');
        if (returnFocus) this.anchor?.focus();
        this.anchor = null;
    }
}

function loadCollapsed() {
    try {
        const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? 'null');
        return Array.isArray(saved) ? saved : ['/lib/adafruit_display_text'];
    } catch {
        return [];
    }
}

function saveCollapsed(collapsed) {
    try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
    }
}
