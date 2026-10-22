export class Menu {
    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'menu';
        this.element.setAttribute('role', 'menu');
        this.element.hidden = true;
        document.body.append(this.element);
        this.anchor = null;
        document.addEventListener('pointerdown', (event) => {
            if (!this.element.hidden && !this.element.contains(event.target) && !this.anchor?.contains(event.target)) {
                this.close();
            }
        });
        this.element.addEventListener('keydown', (event) => {
            const buttons = [...this.element.querySelectorAll('button:not(:disabled)')];
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
        this.show(items, null);
    }

    show(items, back) {
        this.element.innerHTML = '';
        if (back) {
            const button = document.createElement('button');
            button.className = 'menu-back';
            button.setAttribute('role', 'menuitem');
            button.textContent = back.title;
            button.setAttribute('aria-label', `Back from ${back.title}`);
            button.addEventListener('click', () => this.show(back.items, back.parent));
            this.element.append(button);
            this.element.append(separator());
        }
        for (const item of items) {
            if (!item) {
                this.element.append(separator());
                continue;
            }
            if (item.heading) {
                const heading = document.createElement('div');
                heading.className = 'menu-heading';
                heading.textContent = item.heading;
                this.element.append(heading);
                continue;
            }
            const button = document.createElement('button');
            button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
            if (item.checked !== undefined) {
                button.setAttribute('aria-checked', String(item.checked));
                const mark = document.createElement('span');
                mark.className = 'menu-check';
                mark.textContent = item.checked ? '✓' : '';
                button.append(mark);
            }
            const label = document.createElement('span');
            label.className = 'menu-label';
            label.textContent = item.label;
            button.append(label);
            if (item.detail) {
                const detail = document.createElement('span');
                detail.className = 'menu-detail';
                detail.textContent = item.detail;
                button.append(detail);
            }
            if (item.danger) button.classList.add('danger');
            if (item.disabled) button.disabled = true;
            if (item.submenu) {
                button.setAttribute('aria-haspopup', 'menu');
                const arrow = document.createElement('span');
                arrow.className = 'menu-arrow';
                arrow.textContent = '›';
                arrow.setAttribute('aria-hidden', 'true');
                button.append(arrow);
                button.addEventListener('click', () =>
                    this.show(item.submenu(), { title: item.label, items, parent: back }),
                );
            } else {
                button.addEventListener('click', () => {
                    this.close();
                    item.run();
                });
            }
            this.element.append(button);
        }
        this.element.hidden = false;
        this.place();
        this.element.querySelector('button:not(:disabled)')?.focus();
    }

    place() {
        const rect = this.anchor.getBoundingClientRect();
        const menu = this.element.getBoundingClientRect();
        const left = Math.min(rect.right - menu.width, window.innerWidth - menu.width - 8);
        const below = rect.bottom + 4;
        const top = below + menu.height > window.innerHeight - 8 ? rect.top - menu.height - 4 : below;
        this.element.style.left = `${Math.max(8, left)}px`;
        this.element.style.top = `${Math.max(8, top)}px`;
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

function separator() {
    const element = document.createElement('div');
    element.className = 'menu-separator';
    element.setAttribute('role', 'separator');
    return element;
}
