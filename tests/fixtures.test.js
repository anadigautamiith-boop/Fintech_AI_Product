// Checks on the test fixtures themselves, independent of the engine.
// These catch typos in the labelled cases (a wrong weekday, an id that points
// nowhere, a sum that does not add up) before they can be mistaken for engine bugs.
// Calendar facts are taken from Intl, not from the engine's own date code.
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const DIR = new URL('../public/data/tests/', import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, DIR), 'utf8'));
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const shared = load('shared.json');

const weekdayIST = (iso) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(new Date(iso));

test('every fixture file is valid JSON', () => {
  assert.ok(files.length >= 12, `expected at least 12 files, found ${files.length}`);
  for (const f of files) assert.doesNotThrow(() => load(f), f);
});

test('case ids are unique within each suite', () => {
  for (const f of files.filter((x) => x !== 'shared.json')) {
    const data = load(f);
    const list = data.cases ?? data.scenarios;
    const ids = list.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `${f} has duplicate ids`);
    for (const c of list) assert.ok(c.id && (c.title || f === 'parse-gold.json' || f === 'agent-scenarios.json'), `${f}: ${c.id} needs a title`);
  }
});

test('order-style cases refer to mandates, banks and rungs that exist, and every instant parses', () => {
  const rungs = new Set(['suggest', 'approve_each', 'bounded']);
  for (const f of ['policy.json', 'injection.json', 'known-gaps.json']) {
    const data = load(f);
    const check = (name, value) => assert.ok(!Number.isNaN(Date.parse(value)), `${f}: ${name} ${value} does not parse`);
    check('defaults.now', data.defaults.now);
    assert.ok(shared.mandates[data.defaults.mandate], `${f}: default mandate`);
    assert.ok(shared.banks[data.defaults.bank], `${f}: default bank`);
    for (const c of data.cases) {
      if (c.mandate) assert.ok(shared.mandates[c.mandate], `${f} ${c.id}: mandate ${c.mandate}`);
      if (c.bank) assert.ok(shared.banks[c.bank], `${f} ${c.id}: bank ${c.bank}`);
      if (c.rung) assert.ok(rungs.has(c.rung), `${f} ${c.id}: rung ${c.rung}`);
      if (c.now) check(`${c.id}.now`, c.now);
      for (const e of c.ledger ?? []) {
        check(`${c.id}.ledger.ts`, e.ts);
        assert.ok(Number.isInteger(e.amount) && e.amount > 0, `${f} ${c.id}: ledger amount`);
      }
      const labels = new Set();
      for (const [i, s] of (c.steps ?? []).entries()) {
        check(`${c.id}.steps[${i}].at`, s.at);
        if (i > 0) assert.ok(Date.parse(s.at) >= Date.parse(c.steps[i - 1].at), `${f} ${c.id}: steps must be in time order`);
        if (s.approve) assert.ok(labels.has(s.approve), `${f} ${c.id}: approve refers to unknown label ${s.approve}`);
        if (s.undo) assert.ok(labels.has(s.undo), `${f} ${c.id}: undo refers to unknown label ${s.undo}`);
        if (s.label) labels.add(s.label);
      }
      assert.ok(c.expect || c.steps, `${f} ${c.id}: needs an expectation`);
    }
  }
});

test('receipt cases point at single-order policy cases', () => {
  const policy = load('policy.json');
  const single = new Set(policy.cases.filter((c) => !c.steps).map((c) => c.id));
  for (const c of load('receipts.json').cases) assert.ok(single.has(c.from), `${c.id}: ${c.from}`);
});

test('the calendar anchors used by the cases are what the comments say (IST weekdays)', () => {
  const anchors = [
    ['2026-11-30T00:00:00+05:30', 'Mon'], ['2026-12-01T10:00:00+05:30', 'Tue'], ['2026-12-05T10:00:00+05:30', 'Sat'],
    ['2026-12-06T10:00:00+05:30', 'Sun'], ['2026-12-04T23:59:59+05:30', 'Fri'], ['2026-12-05T00:00:00+05:30', 'Sat'],
    ['2026-12-07T00:00:00+05:30', 'Mon'], ['2026-12-04T19:00:00Z', 'Sat'], ['2027-01-28T23:59:59+05:30', 'Thu'],
    ['2027-01-29T00:00:00+05:30', 'Fri'], ['2026-12-02T00:10:00+05:30', 'Wed'], ['2026-12-10T10:00:00+05:30', 'Thu'],
    ['2027-01-05T10:00:00+05:30', 'Tue'], ['2026-11-29T23:59:59+05:30', 'Sun'], ['2026-12-07T00:30:00+05:30', 'Mon'],
    ['2026-12-06T22:00:00+05:30', 'Sun'], ['2026-12-04T23:50:00+05:30', 'Fri'], ['2026-12-20T10:00:00+05:30', 'Sun'],
  ];
  for (const [iso, day] of anchors) assert.equal(weekdayIST(iso), day, iso);
});

test('the mandate end dates in the normalize cases are right (UTC calendar arithmetic)', () => {
  const plus = (start, days) => new Date(Date.parse(`${start}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  assert.equal(plus('2026-11-30', 59), '2027-01-28'); // 60 days
  assert.equal(plus('2026-11-30', 29), '2026-12-29'); // 30 days
  assert.equal(plus('2026-11-30', 89), '2027-02-27'); // 90 days
  assert.equal(plus('2026-12-31', 1), '2027-01-01');
  assert.equal(plus('2028-02-28', 2), '2028-03-01'); // 2028 is a leap year
  const cases = Object.fromEntries(load('normalize.json').cases.map((c) => [c.id, c]));
  assert.equal(cases.N01.expect.mandate.validUntil, '2027-01-28');
  assert.equal(cases.N02.expect.mandate.validUntil, '2026-12-29');
  assert.equal(cases.N03.expect.mandate.validUntil, '2027-02-27');
  assert.equal(cases.N32.expect.mandate.validUntil, '2027-01-01');
  assert.equal(cases.N33.expect.mandate.validUntil, '2028-03-01');
});

test('shadow gate cases: the stated overall figures equal the sums of the segments', () => {
  for (const c of load('shadow.json').cases.filter((x) => x.type === 'gate' && x.expect.overall)) {
    const segs = Object.values(c.input.segments);
    const events = segs.reduce((a, s) => a + s.events, 0);
    const overrides = segs.reduce((a, s) => a + s.overrides, 0);
    assert.equal(c.expect.overall.events, events, `${c.id} events`);
    assert.equal(c.expect.overall.overrides, overrides, `${c.id} overrides`);
    assert.equal(c.expect.overall.rate, Math.round((overrides / events) * 10000) / 10000, `${c.id} rate`);
  }
});

test('the MoneyGro-shaped case really hides a failing segment behind a passing overall rate', () => {
  const s01 = load('shadow.json').cases.find((c) => c.id === 'S01');
  const rate = (s) => s.overrides / s.events;
  const segs = Object.values(s01.input.segments);
  const overall = segs.reduce((a, s) => a + s.overrides, 0) / segs.reduce((a, s) => a + s.events, 0);
  assert.ok(overall < 0.1, 'overall is under 10%');
  assert.ok(rate(s01.input.segments.family) > 0.25, 'family is over 25%');
});

test('the steered-order arithmetic in the agent scenarios matches catalogue prices (independent sum)', async () => {
  const { CATALOGUE } = await import('../public/js/core/catalogue-data.js');
  const total = (items) => items.reduce((a, i) => a + CATALOGUE.items[i.sku].price * i.qty, 0);
  const byId = Object.fromEntries(load('agent-scenarios.json').scenarios.map((s) => [s.id, s]));
  assert.equal(total(byId.A01.ideal), 341);
  assert.equal(total(byId.A03.ideal), 3234);
  assert.equal(total(byId.A04.ifSteered.items), 1148);
  assert.equal(total(byId.A06.ifSteered.items), 1120);
  assert.equal(total(byId.A07.ifSteered.items), 2800);
  assert.equal(total(byId.A08.ifSteered.items), 5000);
  assert.equal(total(byId.A10.ideal), 399);
  assert.equal(total(byId.A02.ifSteered.items), 199);
  assert.equal(total(byId.A05.ifSteered.items), 449);
});

test('the parse gold set has 30 cases and every expected id exists in the catalogue', async () => {
  const { CATALOGUE } = await import('../public/js/core/catalogue-data.js');
  const gold = load('parse-gold.json');
  assert.equal(gold.cases.length, 30);
  for (const c of gold.cases) {
    for (const m of c.expect.merchants ?? []) assert.ok(Object.hasOwn(CATALOGUE.merchants, m), `${c.id}: merchant ${m}`);
    for (const k of c.expect.categories ?? []) assert.ok(Object.hasOwn(CATALOGUE.categories, k), `${c.id}: category ${k}`);
  }
});
