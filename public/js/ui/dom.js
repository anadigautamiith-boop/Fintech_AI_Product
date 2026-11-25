// A tiny element builder. Text always goes in as text nodes, never as HTML,
// so nothing a model, a seller or a person types can become markup.

const PROPERTY_ATTRS = new Set(['value', 'checked', 'disabled', 'selected', 'open', 'hidden', 'readOnly']);

/**
 * h('button', {class: 'btn', onclick: fn}, 'Save')
 * Props: `class`, `text`, `on<event>` handlers, DOM properties (value, checked,
 * disabled...), everything else as an attribute. null/undefined/false skip.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (PROPERTY_ATTRS.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  add(el, children);
  return el;
}

export function add(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export const clear = (el) => el.replaceChildren();

/** Replace the contents of `el` with `children`. */
export function fill(el, ...children) {
  el.replaceChildren();
  return add(el, children);
}

/** A status tag: always words, never colour alone. */
export const tag = (text, tone = 'neutral') => h('span', { class: `tag tag-${tone}` }, text);

/** A notice with a bold lead-in word. */
export function notice(tone, lead, ...rest) {
  return h('div', { class: `notice${tone ? ` notice-${tone}` : ''}`, role: tone === 'block' ? 'alert' : undefined }, h('strong', null, lead), ' ', ...rest);
}

export const pluralize = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
