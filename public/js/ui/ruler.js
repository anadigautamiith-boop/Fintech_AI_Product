// The limits ruler: a money axis that ends a little past the order and the
// limits near it, with each limit drawn as a fence (dashed: this app checks it,
// solid: the bank holds it) and the order as a pin. The drawing is for the
// eye only (aria-hidden); the list under it says everything it shows, in words,
// so nobody has to read the picture.

import { h } from './dom.js';
import { rulerModel, fenceText } from '../logic.js';
import { rupees } from './format.js';

const CLOSE = 8; // percent of the axis: letters closer than this are put on a second row

function place(el, pct) {
  el.style.left = `${pct}%`; // CSSOM, not an inline style attribute, so a strict CSP is fine
  return el;
}

/**
 * @param {{fences: object[], amount?: number|null, label?: string}} input
 */
export function renderRuler({ fences, amount = null, label = 'Limits' }) {
  const m = rulerModel({ fences, amount });
  const track = h('div', { class: 'ruler-track', 'aria-hidden': 'true' }, h('div', { class: 'ruler-axis' }));

  if (m.pin) {
    const fill = h('div', { class: `ruler-fill${m.pin.over ? ' ruler-fill-over' : ''}` });
    fill.style.width = `${m.pin.pct}%`;
    track.append(fill);
  }
  track.append(h('span', { class: 'ruler-end ruler-end-zero' }, rupees(0)), h('span', { class: 'ruler-end ruler-end-max' }, rupees(m.max)));

  let lastTop = -100;
  let lastLow = -100;
  let anyLow = false;
  for (const f of m.fences) {
    const low = f.pct - lastTop < CLOSE && f.pct - lastLow >= CLOSE;
    if (low) { lastLow = f.pct; anyLow = true; } else lastTop = f.pct;
    track.append(place(h('div', { class: `ruler-fence ruler-fence-${f.who}${low ? ' ruler-fence-low' : ''}` }, h('span', { class: 'ruler-letter' }, f.letter)), f.pct));
  }
  if (anyLow) track.classList.add('ruler-track-2');
  if (m.pin) track.append(place(h('div', { class: `ruler-pin${m.pin.over ? ' ruler-pin-over' : ''}` }, rupees(m.pin.value)), m.pin.pct));

  const lines = [];
  if (m.pin) {
    lines.push(h('li', null, h('span', { class: `letter letter-pin${m.pin.over ? ' letter-pin-over' : ''}`, 'aria-hidden': 'true' }),
      h('span', { class: m.pin.over ? 'over' : null }, `This order: ${rupees(m.pin.value)}${m.pin.over ? ', over a limit' : ''}`)));
  }
  for (const f of [...m.fences, ...m.offScale]) {
    const t = fenceText(f, m.amount);
    lines.push(h('li', null,
      h('span', { class: `letter letter-${f.who}`, 'aria-hidden': 'true' }, f.letter),
      h('span', null, t.main, f.pct === null ? ' Too far along the scale to draw.' : '', ' ', h('span', { class: 'who' }, t.who))));
  }

  return h('figure', { class: 'ruler', 'aria-label': label },
    track,
    h('ul', { class: 'legend' }, lines));
}
