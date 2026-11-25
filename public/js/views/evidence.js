// Evidence: the autonomy ladder and the gate that decides whether the assistant
// may move up it. The record is invented (a seeded random generator), so the
// screen can show how the gate behaves, including the case where an average
// looks fine and one group is struggling. There is no way around the gate.

import { h, fill, notice, tag, stackable } from '../ui/dom.js';
import { segmented } from '../ui/form.js';
import { percent } from '../ui/format.js';
import { RUNGS, RUNG_LABELS, DEFAULT_MIN_EVENTS, DEFAULT_THRESHOLD } from '../core/ladder.js';
import { SEGMENTS } from '../core/shadow.js';
import { gateReasons, hiddenGapText } from '../logic.js';
import { SHADOW_SEED, SHADOW_EVENTS_PER_WEEK } from '../store.js';

const RUNG_TEXT = {
  suggest: 'The assistant proposes orders. Nothing is paid unless you press Approve.',
  approve_each: 'Every order waits for your OK, even one that is inside every limit.',
  bounded: 'An order inside every limit is paid at once. Anything above your ask-me line waits for you, and anything outside the limits is blocked.',
};
const LABELS = Object.fromEntries(SEGMENTS.map((s) => [s.id, s.label]));
const BAR_SCALE = 0.3; // the bars run from 0% to 30%, so the 10% line sits a third of the way along

function place(el, prop, pct) {
  el.style[prop] = `${pct}%`;
  return el;
}

export function mount(root, ctx) {
  const { store } = ctx;
  const s0 = store.get();

  // ------------------------------------------------------------ controls (built once)
  const dataset = segmented({
    legend: 'Which invented record to look at',
    name: 'record-set',
    options: [
      { value: 'healthy', label: 'Fine in every group' },
      { value: 'hidden_gap', label: 'One group struggles' },
    ],
    value: s0.evidence.set,
    onChange: (v) => store.setEvidence({ set: v }),
    stacked: true,
  });
  const weeks = h('input', { type: 'range', id: 'weeks', min: '1', max: '12', step: '1', value: String(s0.evidence.weeks), class: 'range' });
  const weeksOut = h('output', { for: 'weeks', class: 'clock-now' });
  weeks.addEventListener('input', () => store.setEvidence({ weeks: Number(weeks.value) }));
  const consent = h('input', { type: 'checkbox', id: 'consent', checked: s0.evidence.consent });
  consent.addEventListener('change', () => store.setEvidence({ consent: consent.checked }));
  const consentRow = h('div', { class: 'field', id: 'consent-row' },
    h('label', { class: 'chip-option', for: 'consent' }, consent, h('span', null, 'I agree to let the assistant act within the limits I set')),
    h('p', { class: 'help' }, 'The last step up needs your say-so as well as the evidence.'));

  // ------------------------------------------------------------ dynamic parts
  const ladderBox = h('div', { id: 'ladder-box' });
  const tableBox = h('div', { id: 'record-table' });
  const gateBox = h('div', { id: 'gate-box' });
  const live = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });

  function renderLadder(s) {
    const at = RUNGS.indexOf(s.rung);
    fill(ladderBox,
      h('ol', { class: 'ladder', 'aria-label': 'Steps of freedom for the assistant' }, RUNGS.map((r, i) => h('li', { class: i === at ? 'on' : i < at ? 'done' : null, 'aria-current': i === at ? 'step' : null },
        h('span', { class: 'dot', 'aria-hidden': 'true' }),
        h('div', null, RUNG_LABELS[r], ' ', i === at ? tag('You are here', 'stamp') : null, h('p', null, RUNG_TEXT[r]))))),
      at > 0
        ? h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { store.stepDown(); live.textContent = `Freedom taken back. The assistant is now at “${RUNG_LABELS[store.get().rung]}”.`; } }, `Take back one step, to “${RUNG_LABELS[RUNGS[at - 1]]}”`),
          h('span', { class: 'small' }, 'Taking freedom back needs no evidence and works at once.'))
        : null);
  }

  function renderTable(s, ev) {
    const { gate } = ev;
    const rows = SEGMENTS.map((seg) => {
      const b = gate.bySegment[seg.id];
      const judged = b.events < DEFAULT_MIN_EVENTS ? ['Too few orders', 'neutral'] : b.rate < DEFAULT_THRESHOLD ? ['Under the line', 'ok'] : ['Over the line', 'block'];
      const bar = place(h('div', { class: `rate-bar${judged[1] === 'block' ? ' rate-bar-over' : ''}` }), 'width', Math.min(100, ((b.rate ?? 0) / BAR_SCALE) * 100));
      return h('tr', null,
        h('th', { scope: 'row' }, seg.label),
        h('td', { class: 'num' }, String(b.events)),
        h('td', { class: 'num' }, String(b.overrides)),
        h('td', { class: 'num' }, percent(b.rate)),
        h('td', { class: 'cell-bar' }, h('div', { class: 'rate', 'aria-hidden': 'true' }, bar, place(h('div', { class: 'rate-fence' }), 'left', (DEFAULT_THRESHOLD / BAR_SCALE) * 100))),
        h('td', null, tag(judged[0], judged[1])));
    });
    const o = gate.overall;
    fill(tableBox, h('div', { class: 'table-wrap' }, stackable(h('table', { class: 'ledger' },
      h('caption', null, `Invented record: ${ev.summary.weeks} ${ev.summary.weeks === 1 ? 'week' : 'weeks'}, ${SHADOW_EVENTS_PER_WEEK} orders a week`),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Group'), h('th', { scope: 'col', class: 'num' }, 'Orders'), h('th', { scope: 'col', class: 'num' }, 'Overridden'),
        h('th', { scope: 'col', class: 'num' }, 'Override rate'), h('th', { scope: 'col' }, `Against the ${Math.round(DEFAULT_THRESHOLD * 100)}% line (dashed)`), h('th', { scope: 'col' }, 'Judged'))),
      h('tbody', null, rows),
      h('tfoot', null, h('tr', null, h('td', null, 'All groups'), h('td', { class: 'num' }, String(o.events)), h('td', { class: 'num' }, String(o.overrides)), h('td', { class: 'num' }, percent(o.rate)), h('td'), h('td')))))));
  }

  function renderGate(s, ev) {
    const { gate } = ev;
    const at = RUNGS.indexOf(s.rung);
    const next = RUNGS[at + 1] ?? null;
    const reasons = gateReasons({ from: s.rung, weeks: s.evidence.weeks, gate, labels: LABELS });
    const story = hiddenGapText({ gate, labels: LABELS });
    const parts = [];
    if (!next) {
      parts.push(notice('', 'The assistant is at the top rung.', 'There is nothing higher to move to. You can take a step back above.'));
    } else if (gate.allowed) {
      parts.push(notice('ok', 'The record supports moving up.', `Every group has at least ${DEFAULT_MIN_EVENTS} orders and is under the ${Math.round(DEFAULT_THRESHOLD * 100)}% line, and the record is long enough.`));
    } else {
      parts.push(notice('ask', 'Not yet.', h('ul', null, reasons.map((r) => h('li', null, r.text)))));
    }
    if (story && next) parts.push(h('p', { class: 'voice' }, story));
    if (next) {
      parts.push(h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', disabled: !gate.allowed, onclick: () => {
          const r = store.promote();
          live.textContent = r.allowed ? `The assistant moved up to “${RUNG_LABELS[store.get().rung]}”.` : 'The record does not support moving up.';
        } }, `Move up to “${RUNG_LABELS[next]}”`),
        h('span', { class: 'small' }, gate.allowed ? 'The gate is open.' : 'The button stays off until every check passes. There is no way around it.')));
    }
    fill(gateBox, parts);
  }

  function refresh() {
    const s = store.get();
    const ev = store.evidence(s);
    dataset.set(s.evidence.set);
    if (Number(weeks.value) !== s.evidence.weeks) weeks.value = String(s.evidence.weeks);
    weeksOut.textContent = `${s.evidence.weeks} ${s.evidence.weeks === 1 ? 'week' : 'weeks'}`;
    if (consent.checked !== s.evidence.consent) consent.checked = s.evidence.consent;
    consentRow.hidden = s.rung !== 'approve_each';
    renderLadder(s);
    renderTable(s, ev);
    renderGate(s, ev);
  }

  // ------------------------------------------------------------ page
  root.append(h('div', null,
    h('header', { class: 'page-head' },
      h('h1', null, 'Evidence before freedom'),
      h('p', { class: 'lede' }, 'The assistant starts on a short lead: it only suggests. It gets more freedom one step at a time, and only when the record shows people rarely overrule it, in every group and not just on average.')),
    notice('ask', 'The record here is invented.', `A seeded random-number generator (seed ${SHADOW_SEED}) makes up each week of orders, so you see the same numbers every time. It shows how the gate behaves. It says nothing about how real people use an assistant.`),
    h('section', { class: 'section', 'aria-labelledby': 'h-ladder' },
      h('h2', { id: 'h-ladder' }, 'The steps of freedom'),
      ladderBox),
    h('section', { class: 'section', 'aria-labelledby': 'h-record' },
      h('h2', { id: 'h-record' }, 'The record'),
      h('p', { class: 'intro' }, 'In shadow mode the assistant proposes orders and a person accepts or overrides them. The share of orders people override, group by group, is the evidence.'),
      h('div', { class: 'form-grid' },
        dataset.el,
        h('div', { class: 'field' }, h('label', { for: 'weeks' }, 'Weeks of record'), weeks, weeksOut)),
      tableBox),
    h('section', { class: 'section', 'aria-labelledby': 'h-gate' },
      h('h2', { id: 'h-gate' }, 'The gate'),
      consentRow,
      gateBox),
    live));
  const off = store.subscribe(refresh);
  refresh();
  return off;
}
