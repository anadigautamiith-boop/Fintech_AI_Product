// Rules: what the assistant may spend, where and when. The form is the source
// of truth. The AI reader can only fill the form in; a person checks it and
// activates it, and the engine in js/core/ checks every value.

import { h, fill, notice, tag, pluralize } from '../ui/dom.js';
import { chipGroup, segmented, textField } from '../ui/form.js';
import { renderRuler } from '../ui/ruler.js';
import { formatDate, rupees, DAY_SHORT } from '../ui/format.js';
import { SHOPS, KINDS, PRESETS, fencesFromMandate, mandateClauses, readerToForm } from '../logic.js';
import { WEEKDAYS } from '../core/time.js';
import { coerceParsed } from '../core/coerce.js';
import { BANK_CHOICES } from '../store.js';

const BY = { 'rail+layer': ['Bank + Reins', 'by'], layer: ['Reins only', 'by by-app'] };
const PERIODS = [['day', 'a day'], ['week', 'a week'], ['month', 'a month']];

export function mount(root, ctx) {
  const { store, catalogue } = ctx;
  const s0 = store.get();

  // ------------------------------------------------------------ reader
  const instr = h('textarea', { id: 'instructions', class: 'ruled', rows: '4', maxlength: '1000', 'aria-describedby': 'instr-help', spellcheck: 'true', placeholder: 'For example: ₹2000 a week on groceries from FreshBasket, nothing on Sundays, ask me above ₹800.' });
  instr.value = s0.instructions;
  instr.addEventListener('input', () => store.setInstructions(instr.value));
  const readBtn = h('button', { type: 'button', class: 'btn', id: 'read-btn' }, 'Read my instructions');
  const readStatus = h('p', { class: 'small', id: 'read-status', role: 'status' });
  const readerOut = h('div', { id: 'reader-out' });
  let reading = false;

  const aiOn = () => ctx.health().ai;
  function paintReaderControls() {
    readBtn.disabled = reading || !aiOn() || instr.value.trim() === '';
    if (reading) return;
    if (!ctx.health().checked) readStatus.textContent = '';
    else if (!aiOn()) readStatus.textContent = 'The AI is not connected in this copy of the app, so fill in the form below by hand.';
    else if (readStatus.dataset.state !== 'result') readStatus.textContent = '';
  }

  async function read() {
    const text = instr.value.trim();
    if (!text || reading) return;
    reading = true;
    readStatus.dataset.state = '';
    readStatus.textContent = 'Reading your instructions…';
    paintReaderControls();
    const answer = await ctx.callApi('/api/parse-mandate', { text });
    reading = false;
    if (!answer.ok) {
      readStatus.textContent = ctx.explainFailure(answer);
      paintReaderControls();
      return;
    }
    // The reader is a model, so its answer is checked again here by the same code the Worker used.
    const coerced = coerceParsed(answer.raw ?? {}, catalogue);
    store.applyReader(readerToForm(coerced));
    syncInputs();
    readStatus.dataset.state = 'result';
    readStatus.textContent = 'Done. The form below now holds what your sentences say. Check it before you activate.';
    paintReaderControls();
    refresh();
  }
  readBtn.addEventListener('click', read);
  instr.addEventListener('input', paintReaderControls);

  // ------------------------------------------------------------ the form
  const shops = chipGroup({
    legend: 'Shops it may pay',
    help: 'Only verified shops are listed. Leave all unticked to allow any verified shop.',
    options: SHOPS.map((x) => ({ value: x.id, label: x.name, hint: catalogue.categories[x.category].label })),
    values: s0.form.merchants,
    onChange: (v) => store.setForm({ merchants: v }),
    describedBy: 'err-merchants',
  });
  const kinds = chipGroup({
    legend: 'Kinds of purchase',
    help: 'Leave all unticked to allow any kind.',
    options: KINDS.map((k) => ({ value: k.id, label: k.label })),
    values: s0.form.categories,
    onChange: (v) => store.setForm({ categories: v }),
    describedBy: 'err-categories',
  });
  const perOrder = textField({ label: 'Most for one order', help: 'Leave empty for no limit per order.', value: s0.form.perOrderCap, inputmode: 'numeric', prefix: '₹', onInput: (v) => store.setForm({ perOrderCap: v }) });
  const periodAmount = textField({ label: 'Spending limit', value: s0.form.periodAmount, inputmode: 'numeric', prefix: '₹', onInput: (v) => store.setForm({ periodAmount: v }) });
  const periodKind = h('select', { id: 'period-kind', 'aria-label': 'Per' }, PERIODS.map(([v, l]) => h('option', { value: v, selected: v === s0.form.periodKind }, l)));
  periodKind.addEventListener('change', () => store.setForm({ periodKind: periodKind.value }));
  const askAbove = textField({ label: 'Ask me above', help: 'Orders above this wait for your OK, even if they are within the limits.', value: s0.form.askAbove, inputmode: 'numeric', prefix: '₹', onInput: (v) => store.setForm({ askAbove: v }) });
  const days = chipGroup({
    legend: 'Days with no buying',
    options: WEEKDAYS.map((d) => ({ value: d, label: DAY_SHORT[d] })),
    values: s0.form.blockedWeekdays,
    onChange: (v) => store.setForm({ blockedWeekdays: v }),
    describedBy: 'err-blockedWeekdays',
  });
  const duration = textField({ label: 'How long the rules last', help: 'In days, from today. A bank payment block lasts at most 90 days.', value: s0.form.durationDays, inputmode: 'numeric', onInput: (v) => store.setForm({ durationDays: v }) });
  const irreversible = h('input', { type: 'checkbox', id: 'irreversible', checked: s0.form.autoApproveIrreversible });
  irreversible.addEventListener('change', () => store.setForm({ autoApproveIrreversible: irreversible.checked }));

  const fieldErrors = {
    merchants: h('p', { class: 'field-error', id: 'err-merchants' }),
    categories: h('p', { class: 'field-error', id: 'err-categories' }),
    blockedWeekdays: h('p', { class: 'field-error', id: 'err-blockedWeekdays' }),
    autoApproveIrreversible: h('p', { class: 'field-error', id: 'err-irreversible' }),
  };

  function syncInputs() {
    const f = store.get().form;
    shops.set(f.merchants);
    kinds.set(f.categories);
    days.set(f.blockedWeekdays);
    perOrder.setValue(f.perOrderCap);
    periodAmount.setValue(f.periodAmount);
    periodKind.value = f.periodKind;
    askAbove.setValue(f.askAbove);
    duration.setValue(f.durationDays);
    irreversible.checked = f.autoApproveIrreversible;
    if (instr.value !== store.get().instructions) instr.value = store.get().instructions;
  }

  // ------------------------------------------------------------ the bank
  const bank = segmented({
    legend: 'How many payment blocks your bank lets you hold at once',
    help: 'A block is money your bank sets aside for one shop, up to ₹10,000, for at most 90 days. The bank sees the shop, the amount and the end date. It does not see kinds of purchase, blocked days or per-order limits: only Reins checks those.',
    name: 'bank-slots',
    options: BANK_CHOICES.map((n) => ({ value: n, label: String(n) })),
    value: s0.bankSlots,
    onChange: (n) => store.setBankSlots(Number(n)),
  });

  // ------------------------------------------------------------ preview and activation
  const preview = h('div', { id: 'preview' });
  const activeBox = h('div', { id: 'active-box' });
  const activateBtn = h('button', { type: 'button', class: 'btn', id: 'activate-btn' }, 'Activate these rules');
  const activateStatus = h('div', { id: 'activate-status', role: 'status' });
  activateBtn.addEventListener('click', () => {
    const r = store.activate();
    if (!r.ok) {
      fill(activateStatus, notice('block', 'These rules were not activated.', h('ul', null, r.errors.map((e) => h('li', null, e.message)))));
      return;
    }
    fill(activateStatus, notice('ok', 'Rules are active.', 'Reins now checks every order against them. ', h('a', { href: '#/shop' }, 'Ask for an order')));
  });

  function renderErrors(draft) {
    const byField = {};
    for (const e of draft.check.errors ?? []) (byField[e.field ?? '*'] ??= []).push(e.message);
    const first = (k) => (byField[k] ? byField[k].join(' ') : '');
    perOrder.setError(first('perOrderCap'));
    askAbove.setError(first('askAbove'));
    periodAmount.setError(first('periodCap'));
    duration.setError(first('durationDays'));
    fieldErrors.merchants.textContent = first('merchants');
    fieldErrors.categories.textContent = first('categories');
    fieldErrors.blockedWeekdays.textContent = first('blockedWeekdays');
    fieldErrors.autoApproveIrreversible.textContent = first('autoApproveIrreversible');
  }

  function renderReaderOut(s) {
    const parts = [];
    if (s.unresolved.length) {
      parts.push(h('div', { class: 'notice notice-ask' },
        h('strong', null, pluralize(s.unresolved.length, 'thing') + ' the reader could not turn into a rule.'),
        ' Activation waits until you fix each one in the form below or dismiss it on purpose.',
        h('ul', null, s.unresolved.map((u) => h('li', null, u.message, ' ',
          h('button', { type: 'button', class: 'link-button', 'aria-label': `Dismiss on purpose: ${u.message}`, onclick: () => store.dismissOpenItem(u.id) }, 'Dismiss on purpose'))))));
    }
    if (s.notes.length) {
      parts.push(h('div', { class: 'notice' }, h('strong', null, 'Notes from the reader.'), h('ul', null, s.notes.map((n) => h('li', null, n)))));
    }
    fill(readerOut, parts);
  }

  function renderPreview(s, draft) {
    const { check, compiled } = draft;
    if (!check.ok) {
      fill(preview, notice('block', pluralize(check.errors.length, 'problem') + ' to fix before these rules can be activated.', h('ul', null, check.errors.map((e) => h('li', null, e.message)))));
      return;
    }
    const blocks = compiled.blocks.length
      ? compiled.blocks.map((b) => `${catalogue.merchants[b.merchantId].name}: up to ${rupees(b.limit)} until ${formatDate(b.validUntil)}`)
      : [];
    const fences = fencesFromMandate(check.mandate, compiled);
    fill(preview,
      h('h3', { class: 'sub' }, 'Your limits on one scale'),
      fences.length ? renderRuler({ fences, label: 'Your limits on one money scale' }) : h('p', { class: 'small' }, 'No spending limits are set.'),
      h('h3', { class: 'sub' }, 'Who checks each rule'),
      h('ul', { class: 'ledger-list', 'aria-label': 'Who checks each rule' }, compiled.rules.map((r) => {
        const [who, cls] = BY[r.enforcedBy];
        return h('li', null, h('span', { class: cls }, who), h('p', null, r.text));
      })),
      blocks.length ? h('div', { class: 'notice' }, h('strong', null, 'Payment blocks the bank would hold.'), h('ul', null, blocks.map((b) => h('li', null, b)))) : null,
      [...check.warnings, ...compiled.warnings].map((w) => notice('ask', 'Heads up.', w.message)));
  }

  function renderActive(s, draft) {
    if (!s.mandate) {
      fill(activeBox, h('p', { class: 'small' }, 'No rules are active yet, so Reins will not check or pay anything.'));
      return;
    }
    const clauses = mandateClauses(s.mandate, formatDate);
    fill(activeBox,
      h('h3', { class: 'sub' }, 'Active now ', tag('Active', 'ok')),
      draft.changed ? notice('ask', 'The form has changes that are not active yet.', 'Reins is still using the rules below until you activate again.') : null,
      h('ul', { class: 'voice' }, clauses.map((c) => h('li', null, c))),
      h('p', { class: 'small' }, `Payment blocks held at the bank: ${s.compiled.blocks.length}. Activating again asks the bank for fresh blocks.`));
  }

  function refresh() {
    const s = store.get();
    const draft = store.draft(s);
    renderErrors(draft);
    renderReaderOut(s);
    renderPreview(s, draft);
    renderActive(s, draft);
    const blockedByOpen = s.unresolved.length > 0;
    activateBtn.disabled = !draft.check.ok || blockedByOpen;
    activateBtn.textContent = s.mandate ? 'Activate these rules again' : 'Activate these rules';
    activateReason.textContent = blockedByOpen
      ? 'Settle the open items above first.'
      : !draft.check.ok ? 'Fix the problems above first.'
        : s.mandate && !draft.changed ? 'The form matches the active rules.' : '';
    paintReaderControls();
  }
  const activateReason = h('span', { class: 'small', id: 'activate-reason' });
  activateBtn.setAttribute('aria-describedby', 'activate-reason');

  // ------------------------------------------------------------ page
  const page = h('div', null,
    h('header', { class: 'page-head' },
      h('h1', null, 'Set the rules'),
      h('p', { class: 'lede' }, 'Say what an AI assistant may spend, where, and when. Reins checks every order against these rules before any money moves, whatever the assistant says.'),
      h('ol', { class: 'steps' },
        h('li', null, 'Set the rules here'),
        h('li', null, h('a', { href: '#/shop' }, 'Ask for an order')),
        h('li', null, h('a', { href: '#/evidence' }, 'Look at the evidence before it gets more freedom')))),

    h('section', { class: 'section', 'aria-labelledby': 'h-say' },
      h('h2', { id: 'h-say' }, 'Say it in your own words'),
      h('p', { class: 'intro', id: 'instr-help' }, 'Optional. An AI model reads your sentences and fills in the form below. It only reads: it cannot turn anything on, and anything it gets wrong shows up in the form for you to fix. Reading replaces what is in the form now.'),
      h('div', { class: 'field' }, h('label', { for: 'instructions' }, 'What the assistant may do'), instr),
      h('div', { class: 'btn-row' }, readBtn, readStatus),
      readerOut),

    h('section', { class: 'section', 'aria-labelledby': 'h-form' },
      h('h2', { id: 'h-form' }, 'The rules'),
      h('p', { class: 'intro' }, 'Start from an example, or set everything yourself. An example only fills the form: nothing is active until you activate it below.'),
      h('div', { class: 'btn-row', role: 'group', 'aria-label': 'Example rules' }, PRESETS.map((p) => h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => { store.applyPreset(p.id); syncInputs(); refresh(); } }, p.label))),
      h('div', null, shops.el, fieldErrors.merchants),
      h('div', null, kinds.el, fieldErrors.categories),
      h('div', { class: 'form-grid' },
        perOrder.el,
        h('div', { class: 'field' },
          h('label', { for: periodAmount.input.id }, 'Spending limit'),
          h('div', { class: 'amount-and-period' }, h('div', { class: 'amount' }, h('span', { 'aria-hidden': 'true' }, '₹'), periodAmount.input), periodKind),
          h('p', { class: 'help' }, 'Leave empty for no limit over time.'),
          periodAmount.error),
        askAbove.el,
        duration.el),
      h('div', null, days.el, fieldErrors.blockedWeekdays),
      h('div', { class: 'field' },
        h('label', { class: 'chip-option', for: 'irreversible' }, irreversible, h('span', null, 'Let it buy things that cannot be undone without asking me (mobile recharges, for example)')),
        h('p', { class: 'help' }, 'Left unticked, an order that cannot be undone always waits for your OK.'),
        fieldErrors.autoApproveIrreversible)),

    h('section', { class: 'section', 'aria-labelledby': 'h-bank' },
      h('h2', { id: 'h-bank' }, 'What your bank can hold'),
      bank.el),

    h('section', { class: 'section', 'aria-labelledby': 'h-do' },
      h('h2', { id: 'h-do' }, 'Check, then activate'),
      preview,
      h('div', { class: 'btn-row' }, activateBtn, activateReason),
      activateStatus,
      activeBox));

  root.append(page);
  const off = store.subscribe(refresh);
  const offHealth = ctx.onHealth(paintReaderControls);
  refresh();
  return () => { off(); offHealth(); };
}
