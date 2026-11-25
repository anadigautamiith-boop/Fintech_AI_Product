// The app's own logic (js/logic.js) and its state store (js/store.js), driven in
// Node with no browser. These are the same functions the screens call, so a
// screen that only draws their results cannot disagree with them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_FORM, DEFAULT_INSTRUCTIONS, SHOPS, KINDS, formToRaw, parseAmountText, readerToForm, mandateClauses,
  defaultClock, nextWeekdayAt10, scriptedItems, niceCeil, rulerModel, fencesFromFigures, fencesFromMandate, fenceText, joinList,
} from '../public/js/logic.js';
import { normalizeMandate } from '../public/js/core/mandate.js';
import { coerceParsed } from '../public/js/core/coerce.js';
import { CATALOGUE } from '../public/js/core/catalogue-data.js';
import { istDate, istWeekday, MINUTE_MS } from '../public/js/core/time.js';
import { buildReceipt } from '../public/js/core/receipt.js';
import { formatDate } from '../public/js/ui/format.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../public/data/tests/${name}.json`, import.meta.url), 'utf8'));
const shared = read('shared');
const scenarios = read('agent-scenarios').scenarios;
const scenario = (id) => scenarios.find((s) => s.id === id);

// Tuesday 1 December 2026, 11:30 IST: a normal weekday during the rules' life.
const TUE = Date.parse('2026-12-01T10:00:00+05:30');
const HOUR = 60 * MINUTE_MS;
const DAY = 24 * HOUR;

// ------------------------------------------------------------------ logic.js

test('the default form is the same mandate the engine fixtures call M_GROC', () => {
  const r = normalizeMandate(formToRaw(DEFAULT_FORM), { today: shared.today, catalogue: CATALOGUE });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const want = shared.mandates.M_GROC;
  for (const key of ['merchants', 'categories', 'perOrderCap', 'periodCap', 'blockedWeekdays', 'askAbove', 'autoApproveIrreversible', 'durationDays']) {
    assert.deepEqual(r.mandate[key], want[key], key);
  }
});

test('the default instructions say what the default form holds', () => {
  assert.match(DEFAULT_INSTRUCTIONS, /3000/);
  assert.match(DEFAULT_INSTRUCTIONS, /1000/);
  assert.match(DEFAULT_INSTRUCTIONS, /1500/);
});

test('amounts typed by a person: rupee signs and commas are fine, anything else is passed on to be refused', () => {
  assert.equal(parseAmountText('₹1,500'), 1500);
  assert.equal(parseAmountText('rs 200'), 200);
  assert.equal(parseAmountText('Rs. 200'), 200);
  assert.equal(parseAmountText(' 75 '), 75);
  assert.equal(parseAmountText(''), null);
  assert.equal(parseAmountText(null), null);
  assert.equal(parseAmountText('12.5'), '12.5');
  assert.equal(parseAmountText('about 500'), 'about 500');
  assert.equal(parseAmountText('-5'), '-5');
});

test('a form with a bad amount is refused by the engine, with the field named', () => {
  const r = normalizeMandate(formToRaw({ ...DEFAULT_FORM, perOrderCap: '12.5' }), { today: shared.today, catalogue: CATALOGUE });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'perOrderCap'));
});

test('an empty form is a mandate with no limits at all, and the engine warns about it', () => {
  const empty = { merchants: [], categories: [], perOrderCap: '', periodAmount: '', periodKind: 'week', askAbove: '', blockedWeekdays: [], autoApproveIrreversible: false, durationDays: '' };
  const r = normalizeMandate(formToRaw(empty), { today: shared.today, catalogue: CATALOGUE });
  assert.equal(r.ok, true);
  assert.equal(r.mandate.merchants, null);
  assert.ok(r.warnings.length > 0, 'a mandate with no limits needs a warning');
});

test('reader output becomes form values; an unverified shop becomes an open item, not a ticked box', () => {
  const coerced = coerceParsed({ merchants: ['FreshBasket', 'FreshBaskett', 'Zepto'], categories: ['groceries', 'jewellery'], perOrderCap: 800, periodCap: { amount: 2000, period: 'weekly' }, blockedWeekdays: ['weekend'], askAbove: null, durationDays: 30 }, CATALOGUE);
  const r = readerToForm(coerced);
  assert.deepEqual(r.form.merchants, ['freshbasket']);
  assert.deepEqual(r.form.blockedWeekdays, ['sat', 'sun']);
  assert.equal(r.form.perOrderCap, '800');
  assert.equal(r.form.periodAmount, '2000');
  assert.equal(r.form.periodKind, 'week');
  assert.equal(r.form.askAbove, '');
  const text = r.unresolved.map((u) => u.value).join(' | ');
  assert.match(text, /FreshBaskett/);
  assert.match(text, /Zepto/);
  assert.match(text, /jewellery/);
  assert.equal(new Set(r.unresolved.map((u) => u.id)).size, r.unresolved.length, 'open items have distinct ids');
  assert.ok(r.unresolved.every((u) => u.message.length > 0));
});

test('reader output with nothing in it gives an empty form and no open items', () => {
  const r = readerToForm(coerceParsed({}, CATALOGUE));
  assert.deepEqual(r.unresolved, []);
  assert.deepEqual(r.form.merchants, []);
  assert.equal(r.form.periodAmount, '');
});

test('shops in the form are only the verified ones', () => {
  assert.ok(SHOPS.length >= 6);
  assert.ok(SHOPS.every((s) => CATALOGUE.merchants[s.id].verified === true));
  assert.ok(!SHOPS.some((s) => s.id === 'freshbaskett'));
  assert.deepEqual(KINDS.map((k) => k.id).sort(), Object.keys(CATALOGUE.categories).sort());
});

test('mandate clauses are short sentences a person would say', () => {
  const r = normalizeMandate(formToRaw(DEFAULT_FORM), { today: '2026-12-01', catalogue: CATALOGUE });
  const clauses = mandateClauses(r.mandate, formatDate);
  assert.ok(clauses.includes('Shops: FreshBasket and QuickMart'));
  assert.ok(clauses.includes('At most ₹1,500 per order'));
  assert.ok(clauses.includes('At most ₹3,000 a week'));
  assert.ok(clauses.includes('Asks you above ₹1,000'));
  assert.ok(clauses.includes('No buying on Saturday and Sunday'));
  assert.ok(clauses.at(-1).startsWith('Runs from '));
});

test('joinList reads like speech', () => {
  assert.equal(joinList([]), '');
  assert.equal(joinList(['a']), 'a');
  assert.equal(joinList(['a', 'b']), 'a and b');
  assert.equal(joinList(['a', 'b', 'c']), 'a, b and c');
});

test('the default clock is 10:00 IST on a weekday, whatever day the app is opened', () => {
  for (let i = 0; i < 14; i += 1) {
    const opened = Date.parse('2026-11-25T03:00:00Z') + i * DAY + (i % 5) * 7 * HOUR;
    const c = defaultClock(opened);
    assert.ok(!['sat', 'sun'].includes(istWeekday(c)), `day ${i}`);
    assert.equal(new Date(c + 330 * MINUTE_MS).toISOString().slice(11, 16), '10:00', `day ${i}`);
    assert.ok(c >= opened - DAY, 'it is not in the past by more than a day');
  }
});

test('next Saturday at 10:00 is always strictly later and on a Saturday', () => {
  for (let i = 0; i < 10; i += 1) {
    const from = TUE + i * DAY + 5 * HOUR;
    const sat = nextWeekdayAt10(from, 'sat');
    assert.equal(istWeekday(sat), 'sat');
    assert.ok(sat > from);
    assert.ok(sat - from <= 8 * DAY);
  }
  // On a Saturday at 10:00 exactly, "next" Saturday is a week later.
  const sat = nextWeekdayAt10(TUE, 'sat');
  assert.equal(nextWeekdayAt10(sat, 'sat') - sat, 7 * DAY);
});

test('the scripted agent orders what was asked for, or what a fully steered agent would order', () => {
  const a02 = scenario('A02');
  assert.deepEqual(scriptedItems(a02, 'fooled'), a02.ifSteered.items);
  const careful = scriptedItems(a02, 'careful');
  assert.ok(careful.every((i) => !a02.steerTargets.skus.includes(i.sku)), 'the careful order avoids the trap');
  const a01 = scenario('A01');
  assert.deepEqual(scriptedItems(a01, 'fooled'), scriptedItems(a01, 'careful'));
  // The returned lines are copies: changing them cannot change the fixture.
  scriptedItems(a01, 'careful')[0].qty = 99;
  assert.notEqual(a01.ideal[0].qty, 99);
});

test('every scripted order for every sample request is something the engine can read', async () => {
  const { buildProposal } = await import('../public/js/core/proposal.js');
  for (const s of scenarios) {
    for (const mode of ['careful', 'fooled']) {
      const r = buildProposal(CATALOGUE, { items: scriptedItems(s, mode) });
      const expectBuilt = mode === 'fooled' && s.ifSteered ? s.ifSteered.expect.built : true;
      assert.equal(r.ok, expectBuilt, `${s.id} ${mode}`);
    }
  }
});

test('niceCeil rounds up to a round number', () => {
  assert.equal(niceCeil(0), 1);
  assert.equal(niceCeil(-4), 1);
  assert.equal(niceCeil(1), 1);
  assert.equal(niceCeil(1120), 1500);
  assert.equal(niceCeil(1501), 2000);
  assert.equal(niceCeil(3360), 4000);
  assert.equal(niceCeil(9000), 10000);
  assert.equal(niceCeil(10001), 15000);
  for (const x of [3, 77, 450, 1234, 98765]) assert.ok(niceCeil(x) >= x);
});

test('the ruler draws near limits to scale and lists a far limit as off the scale', () => {
  const m = rulerModel({
    amount: 1200,
    fences: [
      { key: 'ask', label: 'Ask me above', value: 1000, who: 'app', kind: 'ask' },
      { key: 'order', label: 'Most for one order', value: 1500, who: 'app', kind: 'limit' },
      { key: 'rail', label: 'Bank block', value: 10000, who: 'bank', kind: 'limit' },
    ],
  });
  assert.equal(m.fences.length, 2);
  assert.equal(m.offScale.length, 1);
  assert.equal(m.offScale[0].key, 'rail');
  assert.ok(m.offScale[0].pct === null);
  assert.ok(m.max >= 1500);
  assert.ok(m.pin.pct > m.fences[0].pct && m.pin.pct < m.fences[1].pct);
  assert.equal(m.pin.over, false);
  assert.equal(m.fences[0].crossed, true, 'the order is above the ask line');
  assert.equal(m.fences[1].crossed, false);
  assert.deepEqual(m.fences.map((f) => f.letter), ['A', 'B']);
  assert.equal(m.offScale[0].letter, 'C');
});

test('the ruler marks an order over a limit', () => {
  const m = rulerModel({ amount: 2000, fences: [{ key: 'order', label: 'Most for one order', value: 1500, who: 'app', kind: 'limit' }] });
  assert.equal(m.pin.over, true);
  assert.ok(m.pin.pct <= 100 && m.fences[0].pct <= 100);
  assert.equal(m.fences[0].crossed, true);
});

test('the ruler works with no order, no limits, or a zero limit', () => {
  const none = rulerModel({ amount: null, fences: [] });
  assert.equal(none.pin, null);
  assert.ok(none.max > 0);
  const zero = rulerModel({ amount: 300, fences: [{ key: 'period', label: 'Left this week', value: 0, who: 'app', kind: 'limit' }] });
  assert.equal(zero.fences[0].pct, 0);
  assert.equal(zero.pin.over, true);
  const limitsOnly = rulerModel({ amount: null, fences: [{ key: 'order', label: 'x', value: 1500, who: 'app', kind: 'limit' }, { key: 'rail', label: 'y', value: 10000, who: 'bank', kind: 'limit' }] });
  assert.ok(limitsOnly.fences.every((f) => f.pct >= 0 && f.pct <= 100));
});

test('a legend line says who holds a limit and how far over the order is', () => {
  const m = rulerModel({ amount: 1800, fences: [{ key: 'order', label: 'Most for one order', value: 1500, who: 'app', kind: 'limit' }, { key: 'ask', label: 'Ask me above', value: 1000, who: 'app', kind: 'ask' }] });
  const byKey = Object.fromEntries(m.fences.map((f) => [f.key, f]));
  assert.deepEqual(fenceText(byKey.order, 1800), { main: 'Most for one order: ₹1,500. This order is ₹300 over.', who: 'checked by this app' });
  assert.match(fenceText(byKey.ask, 1800).main, /you are asked/);
  const bank = { key: 'rail', label: 'Bank block', value: 10000, who: 'bank', kind: 'limit', crossed: false };
  assert.equal(fenceText(bank, 1800).who, 'held by the bank, checked again by this app');
});

test('fences come from the engine figures and from the mandate, with the bank kept apart from the app', () => {
  const r = normalizeMandate(formToRaw(DEFAULT_FORM), { today: '2026-12-01', catalogue: CATALOGUE });
  const fromMandate = fencesFromMandate(r.mandate, { blocks: [{ merchantId: 'freshbasket' }], blockSize: 10000 });
  assert.deepEqual(fromMandate.map((f) => f.key), ['ask', 'order', 'period', 'rail']);
  assert.deepEqual(fromMandate.map((f) => f.who), ['app', 'app', 'app', 'bank']);
  const figures = { askAbove: 1000, perOrderCap: 1500, period: { cap: 3000, kind: 'week', remainingBefore: 2200 }, rail: { limit: 10000, remainingBefore: 9000 } };
  assert.deepEqual(fencesFromFigures(figures).map((f) => [f.key, f.value]), [['ask', 1000], ['order', 1500], ['period', 2200], ['rail', 9000]]);
  assert.deepEqual(fencesFromFigures({ askAbove: null, perOrderCap: null, period: { cap: null }, rail: { limit: null } }), []);
});

// ------------------------------------------------------------------ the store

async function freshStore(fakeStorage) {
  if (fakeStorage) globalThis.localStorage = fakeStorage;
  else delete globalThis.localStorage;
  const store = await import(`../public/js/store.js?copy=${Math.random()}`);
  store.reset(TUE);
  store.setClock(TUE);
  return store;
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

const order = (...pairs) => ({ items: pairs.map(([sku, qty]) => ({ sku, qty })) });
const ASK = (store, req, ...pairs) => store.proposeOrder({ request: req, output: order(...pairs), source: 'test' });

function climbTo(store, rung) {
  const steps = { approve_each: [['healthy', 4, false]], bounded: [['healthy', 4, false], ['healthy', 8, true]] }[rung] ?? [];
  for (const [set, weeks, consent] of steps) {
    store.setEvidence({ set, weeks, consent });
    assert.equal(store.promote().allowed, true, `promote with ${set}/${weeks}`);
  }
  assert.equal(store.get().rung, rung);
}

test('a new visitor starts with no rules, the cautious rung and a weekday clock', async () => {
  const store = await freshStore();
  const s = store.get();
  assert.equal(s.mandate, null);
  assert.equal(s.rung, 'suggest');
  assert.deepEqual(s.feed, []);
  assert.equal(s.ledgerState.paused, false);
  assert.ok(!['sat', 'sun'].includes(istWeekday(s.clockMs)));
});

test('rules from the default form can be activated, and the compile step reports what the bank holds', async () => {
  const store = await freshStore();
  const r = store.activate();
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const c = store.compiled();
  assert.equal(c.blocks.length, 2);
  assert.equal(c.bank.maxActiveBlocks, 2);
  store.setBankSlots(1);
  assert.equal(store.compiled().blocks.length, 1);
  assert.ok(store.compiled().warnings.some((w) => w.code === 'BANK_BLOCK_LIMIT'));
});

test('rules with an error are not activated, and the old rules stay', async () => {
  const store = await freshStore();
  assert.equal(store.activate().ok, true);
  const before = store.get().mandate;
  store.setForm({ perOrderCap: 'lots' });
  const r = store.activate();
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'perOrderCap'));
  assert.equal(store.get().mandate, before);
});

test('open items from the reader stop activation until each is settled', async () => {
  const store = await freshStore();
  store.applyReader(readerToForm(coerceParsed({ merchants: ['Zepto'], categories: ['groceries'], periodCap: { amount: 2000, period: 'week' } }, CATALOGUE)));
  assert.equal(store.get().unresolved.length, 1);
  const blocked = store.activate();
  assert.equal(blocked.ok, false);
  assert.equal(blocked.errors[0].code, 'OPEN_ITEMS');
  assert.equal(store.get().mandate, null);
  store.dismissOpenItem(store.get().unresolved[0].id);
  assert.equal(store.get().unresolved.length, 0);
  assert.equal(store.activate().ok, true);
});

test('with no rules set nothing is checked or paid, and nothing is added to the feed', async () => {
  const store = await freshStore();
  const entry = ASK(store, 'milk', ['FB-MILK', 1]);
  assert.equal(entry.status, 'no_rules');
  assert.equal(entry.id, null);
  assert.deepEqual(store.get().feed, []);
  assert.equal(store.get().ledgerState.ledger.length, 0);
  assert.equal(store.approve('D1').ok, false);
});

test('activating again asks for fresh payment blocks, but past orders still count toward the period limit', async () => {
  const store = await freshStore();
  store.activate();
  const e = ASK(store, 'milk', ['FB-MILK', 1]);
  store.approve(e.id);
  assert.equal(store.get().ledgerState.railUsed.freshbasket, 56);
  store.activate();
  assert.deepEqual(store.get().ledgerState.railUsed, {});
  assert.equal(store.get().ledgerState.ledger.length, 1);
  store.advanceClock(2 * HOUR);
  const next = ASK(store, 'milk', ['FB-MILK', 1]);
  assert.equal(next.decision.figures.period.spentBefore, 56);
  assert.equal(next.decision.figures.rail.used, 0);
});

test('suggest rung: nothing is paid until the person approves; then it is paid, and can be undone', async () => {
  const store = await freshStore();
  store.activate();
  const e = ASK(store, 'atta and milk', ['FB-ATTA', 1], ['FB-MILK', 1]);
  assert.equal(e.status, 'suggested');
  assert.equal(e.proposal.amount, 285 + 56);
  assert.equal(store.get().ledgerState.ledger.length, 0);
  assert.equal(buildReceipt(e.decision).headline, 'Suggestion: ₹341 at FreshBasket');

  assert.deepEqual(store.approve(e.id), { ok: true });
  const paid = store.get().feed[0];
  assert.equal(paid.status, 'paid');
  assert.equal(paid.approved, true);
  assert.equal(store.get().ledgerState.ledger.length, 1);
  assert.equal(store.get().ledgerState.railUsed.freshbasket, 341);
  assert.equal(store.metrics().keptShare, 1);

  store.advanceClock(10 * MINUTE_MS);
  assert.deepEqual(store.undo(e.id), { ok: true });
  assert.equal(store.get().feed[0].status, 'refunded');
  assert.equal(store.metrics().reversalRate, 1);
  assert.equal(store.get().ledgerState.railUsed.freshbasket, 341, 'a refund does not give the bank block back');
  assert.equal(store.undo(e.id).ok, false, 'an order cannot be undone twice');
  assert.equal(store.approve(e.id).ok, false, 'a refunded order cannot be approved again');
});

test('the undo window closes: 15 minutes for groceries', async () => {
  const store = await freshStore();
  store.activate();
  const e = ASK(store, 'milk', ['FB-MILK', 1]);
  store.approve(e.id);
  store.advanceClock(16 * MINUTE_MS);
  const r = store.undo(e.id);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'UNDO_WINDOW_CLOSED');
  assert.equal(store.get().feed[0].status, 'paid');
});

test('declining or dismissing leaves the ledger alone and cannot be repeated', async () => {
  const store = await freshStore();
  store.activate();
  const a = ASK(store, 'milk', ['FB-MILK', 1]);
  assert.deepEqual(store.decline(a.id), { ok: true });
  assert.equal(store.get().feed[0].status, 'dismissed');
  assert.equal(store.get().ledgerState.ledger.length, 0);
  assert.equal(store.decline(a.id).ok, false);
  assert.equal(store.approve(a.id).ok, false);
  assert.equal(store.approve('D999').ok, false);
});

test('a blocked order cannot be approved', async () => {
  const store = await freshStore();
  store.activate();
  const e = ASK(store, 'fake shop', ['FK-ATTA', 1]);
  assert.equal(e.status, 'blocked');
  assert.deepEqual(e.decision.reasons, ['MERCHANT_UNVERIFIED']);
  assert.equal(store.approve(e.id).ok, false);
  assert.equal(store.get().ledgerState.ledger.length, 0);
});

test('an order the engine cannot build is kept in the feed with the reasons, and nothing is checked or paid', async () => {
  const store = await freshStore();
  store.activate();
  const mixed = ASK(store, 'mixed', ['FB-MILK', 1], ['QM-MILK', 1]);
  assert.equal(mixed.status, 'not_built');
  assert.deepEqual(mixed.errors, ['MIXED_MERCHANTS']);
  assert.equal(mixed.decision, null);
  const junk = store.proposeOrder({ request: 'x', output: 'not an object', source: 'test' });
  assert.equal(junk.status, 'not_built');
  assert.deepEqual(junk.rawItems, null);
  const none = store.proposeOrder({ request: 'x', output: { items: [] }, source: 'test' });
  assert.deepEqual(none.errors, ['NO_ITEMS']);
  assert.equal(store.get().ledgerState.ledger.length, 0);
});

test('approve-each rung: every order waits, including one that is inside every limit', async () => {
  const store = await freshStore();
  store.activate();
  climbTo(store, 'approve_each');
  const e = ASK(store, 'milk', ['FB-MILK', 1]);
  assert.equal(e.status, 'awaiting_approval');
  assert.equal(store.get().ledgerState.ledger.length, 0);
  assert.equal(store.approve(e.id).ok, true);
  assert.equal(store.get().ledgerState.ledger.length, 1);
});

test('bounded rung: inside the limits it pays, above the ask line it asks, over a limit it stops', async () => {
  const store = await freshStore();
  store.activate();
  climbTo(store, 'bounded');

  const inside = ASK(store, 'milk', ['FB-MILK', 2]);
  assert.equal(inside.status, 'paid');
  assert.equal(inside.approved, false);
  assert.equal(store.get().ledgerState.ledger.length, 1);

  const asks = ASK(store, 'rice', ['FB-RICE', 2]); // ₹1,240: above ₹1,000, under ₹1,500
  assert.equal(asks.status, 'awaiting_approval');
  assert.deepEqual(asks.decision.reasons, ['ASK_ABOVE_THRESHOLD']);
  assert.equal(store.get().ledgerState.ledger.length, 1);

  const over = ASK(store, 'stock up', ['FB-RICE', 3]); // ₹1,860: over the ₹1,500 order limit
  assert.equal(over.status, 'blocked');
  assert.ok(over.decision.reasons.includes('OVER_ORDER_CAP'));
  assert.equal(store.approve(over.id).ok, false);
  assert.equal(store.get().ledgerState.ledger.length, 1);
});

test('the period limit adds up across orders, and a refund frees what it spent', async () => {
  const store = await freshStore();
  store.activate();
  climbTo(store, 'bounded');
  // ₹3,000 a week. Three orders of ₹960 (FB-RICE ×1 = 620; use veg boxes at 399×2 = 798 -> keep each ≤ ₹1,000 so none asks).
  const ids = [];
  for (let i = 0; i < 3; i += 1) {
    store.advanceClock(2 * HOUR); // not a duplicate or split pattern
    const e = ASK(store, 'veg', ['FB-VEG', 2]);
    assert.equal(e.status, 'paid', `order ${i + 1}: ${JSON.stringify(e.decision?.reasons)}`);
    ids.push(e.id);
  }
  store.advanceClock(2 * HOUR);
  const fourth = ASK(store, 'veg', ['FB-VEG', 2]); // 4 × 798 = 3,192 > 3,000
  assert.equal(fourth.status, 'blocked');
  assert.ok(fourth.decision.reasons.includes('OVER_PERIOD_CAP'));

  // Undo the latest paid order (inside its 15-minute window), then the same order fits.
  const last = store.get().feed.find((x) => x.id === ids[2]);
  assert.equal(last.status, 'paid');
  store.setClock(last.at + 5 * MINUTE_MS);
  assert.equal(store.undo(last.id).ok, true);
  store.advanceClock(HOUR);
  const retry = ASK(store, 'veg again', ['FB-VEG', 2]);
  assert.equal(retry.status, 'paid');
});

test('a duplicate order a few minutes later asks first, even at the bounded rung', async () => {
  const store = await freshStore();
  store.activate();
  climbTo(store, 'bounded');
  assert.equal(ASK(store, 'milk', ['FB-MILK', 1]).status, 'paid');
  store.advanceClock(5 * MINUTE_MS);
  const again = ASK(store, 'milk', ['FB-MILK', 1]);
  assert.equal(again.status, 'awaiting_approval');
  assert.deepEqual(again.decision.reasons, ['ASK_POSSIBLE_DUPLICATE']);
});

test('weekend: the engine blocks on a blocked day, and the clock shows it', async () => {
  const store = await freshStore();
  store.activate();
  climbTo(store, 'bounded');
  assert.equal(store.blockedToday(), false);
  store.setClock(nextWeekdayAt10(store.get().clockMs, 'sat'));
  assert.equal(store.blockedToday(), true);
  const e = ASK(store, 'milk', ['FB-MILK', 1]);
  assert.equal(e.status, 'blocked');
  assert.deepEqual(e.decision.reasons, ['BLOCKED_DAY']);
});

test('pause stops new orders, and an order that was waiting is checked again when approved', async () => {
  const store = await freshStore();
  store.activate();
  climbTo(store, 'approve_each');
  const waiting = ASK(store, 'milk', ['FB-MILK', 1]);
  assert.equal(waiting.status, 'awaiting_approval');
  store.pause(true);
  const refused = store.approve(waiting.id);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'BLOCKED_ON_APPROVAL');
  assert.equal(store.get().feed.find((x) => x.id === waiting.id).status, 'blocked_on_approval');
  assert.deepEqual(store.get().feed.find((x) => x.id === waiting.id).decision.reasons, ['MANDATE_PAUSED']);
  assert.equal(store.get().ledgerState.ledger.length, 0);
  const another = ASK(store, 'eggs', ['FB-EGGS', 1]);
  assert.equal(another.status, 'blocked');
  store.pause(false);
  assert.equal(ASK(store, 'eggs', ['FB-EGGS', 1]).status, 'awaiting_approval');
});

test('the rules end: after the last day an order is blocked', async () => {
  const store = await freshStore();
  store.activate();
  climbTo(store, 'bounded');
  store.setClock(store.get().clockMs + 61 * DAY);
  const e = ASK(store, 'milk', ['FB-MILK', 1]);
  assert.equal(e.status, 'blocked');
  assert.deepEqual(e.decision.reasons, ['MANDATE_EXPIRED']);
});

test('every hostile sample, fully fooled, is stopped or asked by the engine at the bounded rung', async () => {
  const store = await freshStore();
  store.activate();
  climbTo(store, 'bounded');
  for (const s of scenarios.filter((x) => x.kind === 'hostile')) {
    store.advanceClock(2 * HOUR);
    const e = store.proposeOrder({ request: s.request, output: { items: scriptedItems(s, 'fooled') }, source: 'scripted fooled', scenario: s });
    assert.equal(e.steered, true, `${s.id} is a steered order`);
    assert.notEqual(e.status, 'paid', `${s.id} was paid without the person`);
    const want = s.ifSteered.expect;
    if (want.built === false) assert.deepEqual(e.errors, want.buildErrors, s.id);
    else {
      assert.equal(e.decision.verdict, want.verdict, s.id);
      assert.deepEqual(e.decision.reasons, want.reasons, s.id);
    }
  }
  assert.equal(store.get().ledgerState.ledger.length, 0);
});

test('a careful scripted agent gets the benign samples paid at the bounded rung', async () => {
  const store = await freshStore();
  store.activate();
  climbTo(store, 'bounded');
  const a01 = scenario('A01');
  const e = store.proposeOrder({ request: a01.request, output: { items: scriptedItems(a01, 'careful') }, source: 'scripted careful', scenario: a01 });
  assert.equal(e.status, 'paid');
  assert.equal(e.steered, null, 'a benign sample has no trap, so "steered" does not apply');
});

test('the feed keeps the newest first and numbers entries without reusing a number', async () => {
  const store = await freshStore();
  store.activate();
  const a = ASK(store, 'a', ['FB-MILK', 1]);
  const b = ASK(store, 'b', ['FB-EGGS', 1]);
  assert.deepEqual(store.get().feed.map((x) => x.id), [b.id, a.id]);
  assert.notEqual(a.id, b.id);
  assert.equal(store.get().nextFeedId, 3);
});

test('notes from the agent are kept short', async () => {
  const store = await freshStore();
  store.activate();
  const e = store.proposeOrder({ request: 'x', output: { items: [{ sku: 'FB-MILK', qty: 1 }], note: 'n'.repeat(5000) }, source: 'test' });
  assert.equal(e.note.length, 200);
});

test('listeners are told after every change, and stop hearing once they leave', async () => {
  const store = await freshStore();
  let heard = 0;
  const off = store.subscribe(() => { heard += 1; });
  store.activate();
  const afterActivate = heard;
  assert.ok(afterActivate >= 1);
  ASK(store, 'a', ['FB-MILK', 1]);
  assert.ok(heard > afterActivate);
  off();
  const stopped = heard;
  ASK(store, 'b', ['FB-EGGS', 1]);
  assert.equal(heard, stopped);
});

test('approval is one change: listeners never see the order paid in the ledger but still waiting in the feed', async () => {
  const store = await freshStore();
  store.activate();
  const e = ASK(store, 'a', ['FB-MILK', 1]);
  const seen = [];
  store.subscribe((s) => seen.push([s.ledgerState.ledger.length, s.feed.find((x) => x.id === e.id).status]));
  store.approve(e.id);
  assert.deepEqual(seen, [[1, 'paid']]);
});

// ---- the ladder through the store

test('the gate needs four weeks of evidence to leave suggest-only, and says why when it will not move', async () => {
  const store = await freshStore();
  store.setEvidence({ set: 'healthy', weeks: 3 });
  const short = store.promote();
  assert.equal(short.allowed, false);
  assert.ok(short.failures.some((f) => f.code === 'TOO_SHORT'));
  assert.equal(store.get().rung, 'suggest');
  store.setEvidence({ set: 'healthy', weeks: 4 });
  assert.equal(store.promote().allowed, true);
  assert.equal(store.get().rung, 'approve_each');
});

test('the gate refuses when one segment is over the line even though the overall rate looks fine', async () => {
  const store = await freshStore();
  store.setEvidence({ set: 'hidden_gap', weeks: 8 });
  const { gate, summary } = store.evidence();
  assert.ok(summary.overall.rate < 0.1, `overall ${summary.overall.rate}`);
  assert.equal(gate.allowed, false);
  assert.ok(gate.failures.some((f) => f.code === 'SEGMENT_OVER_THRESHOLD' && f.segment === 'family'));
  const r = store.promote();
  assert.equal(r.allowed, false);
  assert.equal(store.get().rung, 'suggest');
});

test('acting within limits needs eight weeks and the person’s consent; consent is spent when used', async () => {
  const store = await freshStore();
  climbTo(store, 'approve_each');
  store.setEvidence({ set: 'healthy', weeks: 8, consent: false });
  assert.ok(store.promote().failures.some((f) => f.code === 'NO_CONSENT'));
  store.setEvidence({ weeks: 7, consent: true });
  assert.ok(store.promote().failures.some((f) => f.code === 'TOO_SHORT'));
  store.setEvidence({ weeks: 8, consent: true });
  assert.equal(store.promote().allowed, true);
  assert.equal(store.get().rung, 'bounded');
  assert.equal(store.get().evidence.consent, false);
  assert.ok(store.promote().failures.some((f) => f.code === 'TOP_RUNG'));
  assert.equal(store.get().rung, 'bounded');
});

test('the healthy and hidden-gap data are the same every time', async () => {
  const a = await freshStore();
  const b = await freshStore();
  for (const set of ['healthy', 'hidden_gap']) {
    a.setEvidence({ set, weeks: 8 });
    b.setEvidence({ set, weeks: 8 });
    assert.deepEqual(a.evidence().summary, b.evidence().summary);
  }
});

// ---- saving in the browser

test('state is saved and read back; a second copy of the app opens where the first left off', async () => {
  const storage = memoryStorage();
  const one = await freshStore(storage);
  one.activate();
  const e = ASK(one, 'milk', ['FB-MILK', 1]);
  one.approve(e.id);
  assert.ok(storage.data['reins.v1']);
  const two = await import(`../public/js/store.js?copy=${Math.random()}`);
  assert.equal(two.get().feed.length, 1);
  assert.equal(two.get().feed[0].status, 'paid');
  assert.equal(two.get().ledgerState.ledger.length, 1);
  assert.equal(two.get().mandate.perOrderCap, 1500);
});

test('saved data that is broken, or from another version, is ignored and the app starts fresh', async () => {
  for (const bad of ['{not json', '[]', 'null', '{"v":2}', '{"v":1,"feed":"x"}', '{"v":1,"feed":[],"ledgerState":{"ledger":[]},"form":{},"clockMs":"soon"}']) {
    delete globalThis.localStorage;
    globalThis.localStorage = memoryStorage({ 'reins.v1': bad });
    const s = await import(`../public/js/store.js?copy=${Math.random()}`);
    assert.equal(s.get().mandate, null, bad);
    assert.equal(s.get().rung, 'suggest', bad);
    assert.deepEqual(s.get().feed, [], bad);
  }
});

test('if the browser will not save (full or blocked), the app still works for the visit', async () => {
  const hostile = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  const store = await freshStore(hostile);
  assert.equal(store.activate().ok, true);
  const e = ASK(store, 'milk', ['FB-MILK', 1]);
  assert.equal(store.approve(e.id).ok, true);
  assert.equal(store.get().ledgerState.ledger.length, 1);
});

test('start again wipes the rules, the feed and the ledger, and the clock returns to a weekday', async () => {
  const store = await freshStore(memoryStorage());
  store.activate();
  climbTo(store, 'approve_each');
  ASK(store, 'milk', ['FB-MILK', 1]);
  store.setClock(nextWeekdayAt10(store.get().clockMs, 'sat'));
  store.resetAll();
  const s = store.get();
  assert.equal(s.mandate, null);
  assert.equal(s.rung, 'suggest');
  assert.deepEqual(s.feed, []);
  assert.equal(s.ledgerState.ledger.length, 0);
  assert.ok(!['sat', 'sun'].includes(istWeekday(s.clockMs)));
  assert.equal(istDate(s.clockMs) >= '2026-01-01', true);
});
