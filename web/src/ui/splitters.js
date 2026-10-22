const STORE_KEY = 'cyd-pane-sizes';

export function initSplitters(workspace) {
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    } catch {
        saved = {};
    }
    const save = () => {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(saved));
        } catch {
        }
    };

    const splitters = [...workspace.querySelectorAll('.splitter')];
    const clampers = [];

    for (const splitter of splitters) {
        const name = splitter.dataset.var;
        const horizontal = splitter.dataset.axis === 'x';
        const invert = splitter.dataset.invert === 'true';
        const min = Number(splitter.dataset.min);
        const maxFixed = Number(splitter.dataset.max);
        const maxShare = Number(splitter.dataset.maxShare ?? 1);
        const fallback = Number(splitter.dataset.default);

        const keep = Number(workspace.dataset[horizontal ? 'keepX' : 'keepY'] ?? 0);
        const limit = (value) => {
            const space = horizontal ? workspace.clientWidth : workspace.clientHeight;
            let others = 0;
            for (const other of splitters) {
                if (other !== splitter && (other.dataset.axis === 'x') === horizontal) {
                    others += parseFloat(getComputedStyle(workspace).getPropertyValue(other.dataset.var)) || 0;
                }
            }
            const gutters = splitters.filter((s) => (s.dataset.axis === 'x') === horizontal).length * 5;
            const room = space - others - gutters - keep;
            const max = Math.max(min, Math.min(maxFixed, space * maxShare, room));
            return Math.round(Math.min(max, Math.max(min, value)));
        };
        const apply = (value) => {
            const size = limit(value);
            workspace.style.setProperty(name, `${size}px`);
            splitter.setAttribute('aria-valuenow', String(size));
            return size;
        };
        const current = () => parseFloat(getComputedStyle(workspace).getPropertyValue(name)) || fallback;

        splitter.setAttribute('role', 'separator');
        splitter.setAttribute('aria-orientation', horizontal ? 'vertical' : 'horizontal');
        splitter.setAttribute('aria-valuemin', String(min));
        splitter.setAttribute('aria-valuemax', String(maxFixed));
        splitter.tabIndex = 0;
        apply(saved[name] ?? fallback);
        clampers.push(() => apply(current()));

        splitter.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            splitter.setPointerCapture(event.pointerId);
            splitter.classList.add('dragging');
            document.body.classList.add(horizontal ? 'resizing-x' : 'resizing-y');
            const start = horizontal ? event.clientX : event.clientY;
            const startSize = current();
            const move = (e) => {
                const delta = (horizontal ? e.clientX : e.clientY) - start;
                saved[name] = apply(startSize + (invert ? -delta : delta));
            };
            const up = () => {
                splitter.classList.remove('dragging');
                document.body.classList.remove('resizing-x', 'resizing-y');
                splitter.removeEventListener('pointermove', move);
                splitter.removeEventListener('pointerup', up);
                splitter.removeEventListener('pointercancel', up);
                save();
            };
            splitter.addEventListener('pointermove', move);
            splitter.addEventListener('pointerup', up);
            splitter.addEventListener('pointercancel', up);
        });

        splitter.addEventListener('dblclick', () => {
            saved[name] = apply(fallback);
            save();
        });

        splitter.addEventListener('keydown', (event) => {
            const keys = horizontal ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
            const direction = keys[event.key];
            if (direction) {
                event.preventDefault();
                saved[name] = apply(current() + direction * (invert ? -1 : 1) * (event.shiftKey ? 64 : 16));
                save();
            }
        });
    }

    window.addEventListener('resize', () => clampers.forEach((clamp) => clamp()));
}
