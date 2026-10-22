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
        this.element.innerHTML = '';
        for (const item of items) {
            if (!item) {
                const separator = document.createElement('div');
                separator.className = 'menu-separator';
                separator.setAttribute('role', 'separator');
                this.element.append(separator);
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
            button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
            if (item.checked !== undefined) {
                button.setAttribute('aria-checked', String(item.checked));
                const mark = document.createElement('span');
                mark.className = 'menu-check';
                mark.textContent = item.checked ? '✓' : '';
                button.append(mark);
            }
            button.append(item.label);
            if (item.danger) button.classList.add('danger');
            if (item.disabled) button.disabled = true;
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
        this.element.querySelector('button:not(:disabled)')?.focus();
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
