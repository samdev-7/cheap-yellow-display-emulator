export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key.includes('-') || key === 'role') node.setAttribute(key, value);
        else node[key] = value;
    }
    node.append(...children);
    return node;
}
