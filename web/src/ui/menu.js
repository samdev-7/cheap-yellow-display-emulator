import { el } from './el.js';

const separator = () => el('div', { className: 'menu-separator', role: 'separator' });

export class Menu {
    constructor() {
        this.element = el('div', { className: 'menu', role: 'menu', hidden: true });
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
            const button = el('button', { className: 'menu-back', role: 'menuitem', textContent: back.title, 'aria-label': `Back from ${back.title}` });
            button.addEventListener('click', () => this.show(back.items, back.parent));
            this.element.append(button, separator());
        }
        for (const item of items) {
            if (!item) {
                this.element.append(separator());
                continue;
            }
            if (item.heading) {
                this.element.append(el('div', { className: 'menu-heading', textContent: item.heading }));
                continue;
            }
            const checkable = item.checked !== undefined;
            const button = el(
                'button',
                { role: checkable ? 'menuitemcheckbox' : 'menuitem', className: item.danger ? 'danger' : '', disabled: Boolean(item.disabled) },
                ...(checkable ? [el('span', { className: 'menu-check', textContent: item.checked ? '✓' : '' })] : []),
                el('span', { className: 'menu-label', textContent: item.label }),
                ...(item.detail ? [el('span', { className: 'menu-detail', textContent: item.detail })] : []),
            );
            if (checkable) button.setAttribute('aria-checked', String(item.checked));
            if (item.submenu) {
                button.setAttribute('aria-haspopup', 'menu');
                button.append(el('span', { className: 'menu-arrow', textContent: '›', 'aria-hidden': 'true' }));
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
