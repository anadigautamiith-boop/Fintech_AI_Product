// Form pieces that more than one screen uses. Each returns the element and a
// small handle to read or set its value, so a screen can update the values
// without rebuilding the inputs (which would lose focus while someone types).

import { h } from './dom.js';

let counter = 0;
export const uid = (prefix) => `${prefix}-${(counter += 1)}`;

/** A row of labelled checkboxes. `options`: [{value, label, hint?}]. */
export function chipGroup({ legend, help, options, values, onChange, describedBy }) {
  const boxes = new Map();
  const group = h('div', { class: 'chips' });
  for (const o of options) {
    const input = h('input', { type: 'checkbox', value: o.value, checked: values.includes(o.value) });
    input.addEventListener('change', () => onChange(options.filter((x) => boxes.get(x.value).checked).map((x) => x.value)));
    boxes.set(o.value, input);
    group.append(h('label', { class: 'chip-option' }, input, h('span', null, o.label, o.hint ? h('span', { class: 'small' }, ` ${o.hint}`) : null)));
  }
  const fieldset = h('fieldset', { 'aria-describedby': describedBy },
    h('legend', { class: 'label' }, legend),
    help ? h('p', { class: 'help' }, help) : null,
    group);
  return {
    el: fieldset,
    set(next) { for (const [value, input] of boxes) input.checked = next.includes(value); },
  };
}

/** A single-choice control that looks like one bar. `options`: [{value, label}]. `stacked`: one option per line on a narrow screen (for long labels). */
export function segmented({ legend, help, name, options, value, onChange, stacked = false }) {
  const inputs = new Map();
  const bar = h('div', { class: stacked ? 'segmented segmented-stack' : 'segmented' });
  for (const o of options) {
    const input = h('input', { type: 'radio', name, value: String(o.value), checked: String(o.value) === String(value), disabled: o.disabled });
    input.addEventListener('change', () => { if (input.checked) onChange(o.value); });
    inputs.set(String(o.value), input);
    bar.append(h('label', null, input, h('span', null, o.label)));
  }
  return {
    el: h('fieldset', null, h('legend', { class: 'label' }, legend), help ? h('p', { class: 'help' }, help) : null, bar),
    set(v) { for (const [k, input] of inputs) input.checked = k === String(v); },
  };
}

/**
 * A labelled text field with room for an error line underneath.
 * Returns the input, the error element and a setter for both.
 */
export function textField({ label, help, value = '', onInput, inputmode, placeholder, prefix, id = uid('f') }) {
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const input = h('input', { type: 'text', id, value, inputmode, placeholder, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': `${help ? helpId : ''} ${errorId}`.trim() });
  input.addEventListener('input', () => onInput(input.value));
  const error = h('p', { class: 'field-error', id: errorId });
  return {
    el: h('div', { class: 'field' },
      h('label', { for: id }, label),
      prefix ? h('div', { class: 'amount' }, h('span', { 'aria-hidden': 'true' }, prefix), input) : input,
      help ? h('p', { class: 'help', id: helpId }, help) : null,
      error),
    input,
    error,
    setValue(v) { if (input.value !== v) input.value = v; },
    setError(message) {
      error.textContent = message ?? '';
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    },
  };
}
