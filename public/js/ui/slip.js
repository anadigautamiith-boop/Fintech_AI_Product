// One receipt slip in the feed. It draws what slipModel() (js/logic.js) and
// the engine decided, and calls back when a person presses a button.
// Text from the assistant or from a seller is untrusted and goes in as text only.

import { h } from './dom.js';
import { fencesFromFigures } from '../logic.js';
import { renderRuler } from './ruler.js';
import { formatShort, rupees } from './format.js';

const SOURCE_LABEL = { ai: 'the AI model', careful: 'a scripted careful assistant', fooled: 'a scripted assistant that obeys hidden instructions' };

function itemsTable(model) {
  if (!model.items) return null;
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'ledger slip-items' },
      h('caption', { class: 'visually-hidden' }, 'Items in this order'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Item'), h('th', { scope: 'col', class: 'num' }, 'Qty'), h('th', { scope: 'col', class: 'num' }, 'Price'), h('th', { scope: 'col', class: 'num' }, 'Line'))),
      h('tbody', null, model.items.map((i) => h('tr', null, h('td', null, i.name), h('td', { class: 'num' }, String(i.qty)), h('td', { class: 'num' }, rupees(i.price)), h('td', { class: 'num' }, rupees(i.lineTotal))))),
      h('tfoot', null, h('tr', null, h('td', { colspan: '3' }, 'Total'), h('td', { class: 'num' }, rupees(model.total))))));
}

/** What the assistant read and said: shown, never believed. */
function transcript(entry, scenario, catalogue) {
  const parts = [];
  if (entry.note) {
    parts.push(h('blockquote', { class: 'quote' }, h('cite', null, 'What the assistant said about its choice (not checked by the app)'), entry.note));
  }
  const overrides = scenario && scenario.listingOverrides ? Object.entries(scenario.listingOverrides) : [];
  for (const [sku, text] of overrides) {
    const item = catalogue.items[sku];
    const where = item ? `${item.name}, ${catalogue.merchants[item.merchantId].name}` : sku;
    parts.push(h('blockquote', { class: 'quote' }, h('cite', null, `Listing text the assistant read for ${where} (written by the seller)`), text));
  }
  if (entry.rawItems && entry.status === 'not_built') {
    parts.push(h('p', { class: 'small' }, 'What the assistant sent:'), h('pre', { class: 'diff' }, JSON.stringify(entry.rawItems, null, 1)));
  }
  if (!parts.length) return null;
  return h('details', null, h('summary', null, 'What the assistant read and said'), parts);
}

/**
 * @param {object} entry the feed entry
 * @param {object} model from slipModel()
 * @param {{catalogue: object, scenario: object|null, isNew: boolean, on: {approve: Function, decline: Function, undo: Function}}} ctx
 */
export function renderSlip(entry, model, { catalogue, scenario, isNew, on }) {
  const label = `${model.headline}`;
  const stamp = h('span', { class: `stamp stamp-${model.stamp.tone}${isNew ? ' stamp-new' : ''}` }, model.stamp.text);
  const who = SOURCE_LABEL[entry.source] ?? entry.source;

  const buttons = model.actions.map((a) => {
    if (a === 'approve') return h('button', { type: 'button', class: 'btn', 'aria-label': `Approve: ${label}`, onclick: () => on.approve(entry.id) }, 'Approve');
    if (a === 'decline') return h('button', { type: 'button', class: 'btn btn-quiet', 'aria-label': `Decline: ${label}`, onclick: () => on.decline(entry.id) }, 'Decline');
    if (a === 'dismiss') return h('button', { type: 'button', class: 'btn btn-quiet', 'aria-label': `Dismiss: ${label}`, onclick: () => on.decline(entry.id) }, 'Dismiss');
    if (a === 'undo') {
      const left = model.undo.minutesLeft;
      return h('button', { type: 'button', class: 'btn btn-quiet', 'aria-label': `Undo: ${label}`, onclick: () => on.undo(entry.id) },
        left > 0 ? `Undo (${left} min left)` : 'Undo (last moments)');
    }
    return null;
  });

  const undoNote = model.undo && !model.undo.open
    ? h('p', { class: 'small' }, `The ${model.undo.windowMin}-minute undo window has closed.`)
    : null;

  const ruler = model.figures && entry.proposal
    ? renderRuler({ fences: fencesFromFigures(model.figures), amount: entry.proposal.amount, label: 'This order against your limits' })
    : null;

  return h('li', { class: 'slip', id: `slip-${entry.id}` },
    h('p', { class: 'slip-ask' }, 'You asked: ', h('q', null, entry.request), ' ', h('span', { class: 'small' }, `Items chosen by ${who}.`)),
    stamp,
    h('h3', { class: 'slip-head', tabindex: '-1' }, model.headline),
    h('ul', { class: 'slip-lines' }, [...model.lines, ...model.notes].map((l) => h('li', null, l))),
    itemsTable(model),
    ruler,
    transcript(entry, scenario, catalogue),
    undoNote,
    buttons.some(Boolean) ? h('div', { class: 'slip-actions' }, buttons) : null,
    h('p', { class: 'slip-foot' }, `${formatShort(entry.at)} IST · ${entry.id}${entry.steered === true ? ' · the assistant went for the trap' : ''}`));
}

