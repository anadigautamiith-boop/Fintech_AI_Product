// Shop: ask the assistant to buy something and see what Reins decides.
// The assistant (a model, or a scripted stand-in) only chooses items. The
// order is built from catalogue prices and checked by the engine; this screen
// draws the outcome and passes the person's buttons to the store.

import { h, fill, notice, tag, stackable } from '../ui/dom.js';
import { segmented } from '../ui/form.js';
import { renderSlip } from '../ui/slip.js';
import { formatShort, percent, rupees } from '../ui/format.js';
import { RUNG_LABELS } from '../core/ladder.js';
import { NOT_MEASURED } from '../core/metrics.js';
import { slipModel, scriptedItems, presetForScenario, periodStatus, sameForm } from '../logic.js';

const MODE_HELP = {
  ai: 'An AI model reads the shops’ listings and chooses the items.',
  careful: 'A scripted assistant that orders exactly what the sample asks for.',
  fooled: 'A scripted assistant that has been fooled completely. It does what the trap in the sample tells it to, so you can see what Reins does even then.',
};
const SOURCE_NOTE = {
  careful: 'Scripted stand-in: orders what was asked for.',
  fooled: 'Scripted stand-in: does what the hidden text in the listing says.',
};

export function mount(root, ctx) {
  const { store, catalogue } = ctx;
  let scenarios = [];
  let defaults = { mandate: 'M_GROC' };
  let selected = null;
  let mode = ctx.health().ai ? 'ai' : 'careful';
  let modeTouched = false;
  let asking = false;
  const seen = new Map(store.get().feed.map((e) => [e.id, e.status]));

  // ------------------------------------------------------------ the ask form
  const input = h('input', { type: 'text', id: 'request', maxlength: '300', autocomplete: 'off', 'aria-describedby': 'request-help', placeholder: 'For example: Order atta and a litre of milk from FreshBasket.' });
  const askBtn = h('button', { type: 'button', class: 'btn', id: 'ask-btn' }, 'Ask the assistant');
  const askNote = h('div', { id: 'ask-note', role: 'status' });
  const askReason = h('span', { class: 'small', id: 'ask-reason' });
  const sampleBox = h('div', { id: 'samples' });
  const sampleInfo = h('div', { id: 'sample-info' });
  const modeHost = h('div', { id: 'mode-host' });
  const modeHelp = h('p', { class: 'help', id: 'mode-help' });
  const guardBox = h('input', { type: 'checkbox', id: 'guard', checked: true });
  const live = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const announce = (text) => { live.textContent = ''; live.textContent = text; };

  let modeControl = null;
  function buildMode() {
    const aiOn = ctx.health().ai;
    modeControl = segmented({
      legend: 'Who chooses the items',
      name: 'agent-mode',
      options: [
        { value: 'ai', label: 'AI model', disabled: !aiOn },
        { value: 'careful', label: 'Scripted, careful' },
        { value: 'fooled', label: 'Scripted, fooled' },
      ],
      value: mode,
      onChange: (v) => { mode = v; modeTouched = true; paintMode(); paintAsk(); },
      stacked: true,
    });
    fill(modeHost, modeControl.el);
    paintMode();
  }
  function paintMode() {
    const aiOn = ctx.health().ai;
    const text = MODE_HELP[mode] + (!aiOn && ctx.health().checked ? ' The AI is not connected in this copy of the app, so only the scripted assistants are available.' : '');
    modeHelp.textContent = text;
  }

  function onHealth() {
    if (!modeTouched) mode = ctx.health().ai ? 'ai' : 'careful';
    buildMode();
    paintAsk();
  }

  input.addEventListener('input', () => {
    if (selected && input.value !== selected.request) { selected = null; paintSamples(); paintSampleInfo(); }
    paintAsk();
  });

  function selectSample(s) {
    selected = selected && selected.id === s.id ? null : s;
    input.value = selected ? selected.request : '';
    paintSamples();
    paintSampleInfo();
    paintAsk();
    if (selected) input.focus();
  }

  function paintSamples() {
    const group = (title, list) => h('div', { class: 'sample-group' },
      h('h3', { class: 'small-head' }, title),
      h('ul', { class: 'samples' }, list.map((s) => h('li', null, h('button', { type: 'button', class: 'sample', 'aria-pressed': String(selected?.id === s.id), onclick: () => selectSample(s) }, s.title)))));
    fill(sampleBox,
      group('Ordinary requests', scenarios.filter((s) => s.kind !== 'hostile')),
      group('Requests with a trap', scenarios.filter((s) => s.kind === 'hostile')));
  }

  function paintSampleInfo() {
    if (!selected) { fill(sampleInfo); return; }
    const s = selected;
    const parts = [];
    const overrides = Object.entries(s.listingOverrides ?? {});
    if (s.kind === 'hostile') {
      parts.push(notice('ask', 'This sample has a trap.', overrides.length
        ? 'A seller wrote the text below into a product listing. The assistant reads listings as information about the product, so it may take the text as an instruction.'
        : 'A look-alike shop that Reins has not verified is cheaper than the real one, and the request asks for the lowest price.'));
    }
    for (const [sku, text] of overrides) {
      const item = catalogue.items[sku];
      parts.push(h('blockquote', { class: 'quote' }, h('cite', null, `Listing text for ${item.name}, ${catalogue.merchants[item.merchantId].name} (written by the seller)`), text));
    }
    const preset = presetForScenario(s, defaults);
    const st = store.get();
    if (preset && !(st.mandate && sameForm(st.activeForm, preset.form))) {
      parts.push(h('div', { class: 'notice' },
        h('strong', null, `This sample was written for the “${preset.label}” rules.`), ' ',
        st.mandate ? 'Your active rules are different, so what happens may differ. ' : 'No rules are active yet. ',
        h('button', { type: 'button', class: 'link-button', onclick: () => { store.applyPreset(preset.id); store.activate(); paintSampleInfo(); paintAsk(); announce(`Rules switched to ${preset.label}.`); } }, `Use the “${preset.label}” rules`)));
    }
    fill(sampleInfo, parts);
  }

  function paintAsk() {
    const st = store.get();
    const needSample = mode !== 'ai' && !selected;
    let reason = '';
    if (!st.mandate) reason = 'Set and activate your rules first.';
    else if (asking) reason = 'Asking the assistant…';
    else if (input.value.trim() === '') reason = 'Type what to buy, or pick a sample.';
    else if (needSample) reason = 'The scripted assistants only know the samples. Pick one, or switch to the AI model.';
    askBtn.disabled = Boolean(reason);
    askReason.textContent = reason;
  }

  async function ask() {
    const st = store.get();
    const request = input.value.trim();
    if (!st.mandate || !request || asking) return;
    const usingSample = selected && request === selected.request;
    if (mode !== 'ai' && !usingSample) return;
    fill(askNote);
    let output;
    let source = mode;
    if (mode === 'ai') {
      asking = true;
      paintAsk();
      const body = { request, guard: guardBox.checked };
      if (usingSample) { body.skus = selected.skus; body.listingOverrides = selected.listingOverrides ?? {}; }
      const answer = await ctx.callApi('/api/agent', body);
      asking = false;
      if (!answer.ok) {
        paintAsk();
        fill(askNote, notice('block', 'The assistant could not answer.', ctx.explainFailure(answer), ' You can switch to a scripted assistant above.'));
        return;
      }
      output = answer.output;
    } else {
      output = { items: scriptedItems(selected, mode), note: SOURCE_NOTE[mode] };
    }
    const entry = store.proposeOrder({ request, output, source, scenario: usingSample ? selected : null });
    paintAsk();
    if (entry.status === 'no_rules') {
      fill(askNote, notice('block', 'There are no rules yet.', h('a', { href: '#/rules' }, 'Set and activate your rules'), ' first.'));
      return;
    }
    announce(`${entry.status === 'not_built' ? 'No order was made' : 'Reins decided'}. See the newest slip below.`);
    focusSlip(entry.id);
  }
  askBtn.addEventListener('click', ask);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!askBtn.disabled) ask(); } });

  // ------------------------------------------------------------ dynamic parts
  const statusBox = h('div', { class: 'status-strip', id: 'status-strip' });
  const feedList = h('ul', { class: 'feed', id: 'feed', 'aria-label': 'Orders and what happened' });
  const feedEmpty = h('p', { class: 'small', id: 'feed-empty' }, 'No orders yet. Pick a sample request above, or type your own, and ask.');
  const statementBox = h('div', { id: 'statement' });

  function focusSlip(id) {
    const el = document.getElementById(`slip-${id}`);
    const head = el && el.querySelector('h3');
    if (head) head.focus();
  }

  const on = {
    approve: (id) => {
      const r = store.approve(id);
      announce(r.ok ? 'Approved and paid.' : 'The checks ran again and now stop this order.');
      focusSlip(id);
    },
    decline: (id) => { store.decline(id); announce('Done. No money moved.'); focusSlip(id); },
    undo: (id) => { const r = store.undo(id); announce(r.ok ? 'Undone. The order is refunded.' : 'It can no longer be undone.'); focusSlip(id); },
  };

  function renderStatus(s) {
    const period = periodStatus(s.mandate, s.ledgerState.ledger, s.clockMs);
    fill(statusBox,
      s.mandate
        ? h('p', null, tag('Rules active', 'ok'), ' ', h('a', { href: '#/rules' }, 'Change the rules'))
        : notice('ask', 'No rules are active yet.', 'Reins will not check or pay anything until you ', h('a', { href: '#/rules' }, 'set and activate them'), '.'),
      h('p', null, 'Freedom given to the assistant: ', h('strong', null, RUNG_LABELS[s.rung]), ' ', h('a', { href: '#/evidence' }, 'See the evidence')),
      period ? h('p', null, `Spent ${period.period === 'day' ? 'today' : `this ${period.period}`}: `, h('strong', null, rupees(period.spent)), ` of ${rupees(period.cap)}`) : null,
      h('label', { class: 'switch' },
        h('input', { type: 'checkbox', checked: s.ledgerState.paused, onchange: (e) => { store.pause(e.target.checked); announce(e.target.checked ? 'Payments paused.' : 'Payments resumed.'); } }),
        'Pause all payments by the assistant'),
      s.ledgerState.paused ? tag('Paused', 'block') : null);
  }

  function renderFeed(s) {
    const now = s.clockMs;
    const ledger = s.ledgerState.ledger;
    const slips = s.feed.map((entry) => {
      const model = slipModel(entry, { ledger, now });
      const isNew = seen.get(entry.id) !== entry.status;
      const scenario = entry.scenarioId ? scenarios.find((x) => x.id === entry.scenarioId) ?? null : null;
      return renderSlip(entry, model, { catalogue, scenario, isNew, on });
    });
    for (const e of s.feed) seen.set(e.id, e.status);
    fill(feedList, slips);
    feedEmpty.hidden = s.feed.length > 0;
  }

  function renderStatement(s) {
    const ledger = s.ledgerState.ledger;
    const m = store.metrics(s);
    const kept = ledger.filter((o) => o.status === 'paid').reduce((t, o) => t + o.amount, 0);
    const rows = ledger.map((o) => h('tr', { class: o.status === 'refunded' ? 'refunded' : null },
      h('td', null, `${formatShort(o.ts)} IST`),
      h('td', null, catalogue.merchants[o.merchantId].name),
      h('td', null, catalogue.categories[o.category].label),
      h('td', { class: 'num amt' }, rupees(o.amount)),
      h('td', null, o.status === 'refunded' ? tag('Refunded', 'neutral') : tag('Paid', 'ok'))));
    const blocks = s.compiled ? s.compiled.blocks : [];
    fill(statementBox,
      ledger.length
        ? h('div', { class: 'table-wrap' }, stackable(h('table', { class: 'ledger' },
          h('caption', null, 'Statement (simulated money)'),
          h('thead', null, h('tr', null, ['When', 'Shop', 'Kind'].map((t) => h('th', { scope: 'col' }, t)), h('th', { scope: 'col', class: 'num' }, 'Amount'), h('th', { scope: 'col' }, 'Status'))),
          h('tbody', null, rows),
          h('tfoot', null, h('tr', null, h('td', { colspan: '3' }, 'Spent and kept'), h('td', { class: 'num' }, rupees(kept)), h('td'))))))
        : h('p', { class: 'small' }, 'Nothing has been paid yet.'),
      h('h3', { class: 'sub' }, 'How it is going'),
      m.executed === 0
        ? h('p', null, 'No orders have been paid yet, so there is nothing to measure.')
        : h('p', null, `${m.executed} paid. ${m.kept} kept and ${m.refunded} undone: `, h('strong', null, `${percent(m.keptShare)} kept without undo`), `, ${percent(m.reversalRate)} undone.`),
      h('p', { class: 'small' }, `Not measured here: ${NOT_MEASURED.join(', ')}. It needs real people.`),
      blocks.length
        ? h('div', { class: 'notice' }, h('strong', null, 'Bank payment blocks.'), h('ul', null, blocks.map((b) => h('li', null, `${catalogue.merchants[b.merchantId].name}: ${rupees(s.ledgerState.railUsed[b.merchantId] ?? 0)} used of ${rupees(b.limit)}. A refund does not give a block back.`))))
        : null);
  }

  function render(s) {
    renderStatus(s);
    renderFeed(s);
    renderStatement(s);
    paintSampleInfo();
    paintAsk();
  }

  // ------------------------------------------------------------ page
  const page = h('div', null,
    h('header', { class: 'page-head' },
      h('h1', null, 'Ask for an order'),
      h('p', { class: 'lede' }, 'Tell the assistant what to buy. It picks items from the shops’ listings. Reins builds the order from catalogue prices, checks it against your rules, and decides what happens next.')),
    h('div', { id: 'status-host' }, statusBox),
    h('section', { class: 'section', 'aria-labelledby': 'h-ask' },
      h('h2', { id: 'h-ask' }, 'What should it buy?'),
      h('p', { class: 'intro' }, 'The assistant sees product names, prices and the seller’s listing text. It never sees which shops Reins has verified. Pick a sample, including the ones with a trap, or type your own request.'),
      sampleBox,
      sampleInfo,
      h('div', { class: 'field' }, h('label', { for: 'request' }, 'Your request'), input, h('p', { class: 'help', id: 'request-help' }, 'Up to 300 characters.')),
      modeHost,
      modeHelp,
      h('details', { class: 'advanced' },
        h('summary', null, 'Advanced: the warning given to the AI'),
        h('label', { class: 'chip-option' }, guardBox, h('span', null, 'Tell the AI that listing text is written by sellers and must not be obeyed')),
        h('p', { class: 'help' }, 'On by default. Turn it off to see what the AI does without the warning. Reins’ own checks do not depend on it.')),
      h('div', { class: 'btn-row' }, askBtn, askReason),
      askNote),
    h('section', { class: 'section', 'aria-labelledby': 'h-feed' },
      h('h2', { id: 'h-feed' }, 'What happened'),
      feedEmpty,
      feedList),
    h('section', { class: 'section', 'aria-labelledby': 'h-statement' },
      h('h2', { id: 'h-statement' }, 'Your statement'),
      statementBox),
    live);

  root.append(page);
  buildMode();
  paintSamples();
  const off = store.subscribe(render);
  const offHealth = ctx.onHealth(onHealth);
  render(store.get());

  ctx.fixtures().then((files) => {
    scenarios = files['agent-scenarios'].scenarios;
    defaults = files['agent-scenarios'].defaults;
    paintSamples();
    render(store.get());
  }).catch((err) => {
    fill(sampleBox, notice('block', 'The sample requests could not be loaded.', String(err.message ?? err), ' You can still type a request if the AI is connected.'));
  });

  return () => { off(); offHealth(); };
}
