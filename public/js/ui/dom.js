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

/**
 * Lets a table turn into stacked cards on a narrow screen (the CSS does the turning).
 * Each cell remembers its column heading, and the table keeps its meaning for
 * assistive technology even when the layout stops being a table.
 */
export function stackable(table) {
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  table.classList.add('stack');
  table.setAttribute('role', 'table');
  for (const part of table.querySelectorAll('thead, tbody, tfoot')) part.setAttribute('role', 'rowgroup');
  for (const row of table.querySelectorAll('tr')) {
    row.setAttribute('role', 'row');
    let col = 0;
    for (const cell of row.children) {
      const span = Number(cell.getAttribute('colspan') || 1);
      if (cell.tagName === 'TH') cell.setAttribute('role', cell.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader');
      else {
        cell.setAttribute('role', 'cell');
        const inFoot = row.parentElement.tagName === 'TFOOT';
        if (heads[col] && span === 1 && !(inFoot && col === 0)) cell.dataset.label = heads[col];
      }
      col += span;
    }
  }
  return table;
}
