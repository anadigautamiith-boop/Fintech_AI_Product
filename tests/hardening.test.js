// Checks that need a catalogue the labelled fixtures do not use: a catalogue
// entry that is damaged or hostile rather than merely unverified.

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../public/js/core/policy.js';
import { normalizeMandate } from '../public/js/core/mandate.js';
import { compileMandate } from '../public/js/core/rail.js';
import { newState } from '../public/js/core/state.js';
import { CATALOGUE } from '../public/js/core/catalogue-data.js';

const NOW = Date.parse('2026-12-01T10:00:00+05:30');

const normalised = normalizeMandate(
  { merchants: ['freshbasket'], perOrderCap: 1500, periodCap: { amount: 6000, period: 'week' }, durationDays: 30 },
  { today: '2026-11-30', catalogue: CATALOGUE },
);
assert.equal(normalised.ok, true, 'the test mandate must be valid');
const mandate = normalised.mandate;
const compiled = compileMandate(mandate, { maxActiveBlocks: 2 });

function withFreshbasket(changes) {
  const merchant = { ...CATALOGUE.merchants.freshbasket, ...changes };
  for (const [key, value] of Object.entries(changes)) if (value === undefined) delete merchant[key];
  return { ...CATALOGUE, merchants: { ...CATALOGUE.merchants, freshbasket: merchant } };
}

function judge(catalogue) {
  return evaluate({ mandate, compiled, state: newState(), proposal: { merchantId: 'freshbasket', amount: 500 }, now: NOW, catalogue, rung: 'bounded' });
}

test('the shipped catalogue lets this order through (control for the cases below)', () => {
  const d = judge(CATALOGUE);
  assert.equal(d.verdict, 'allow');
  assert.equal(d.outcome, 'executed');
});

for (const [label, value] of [
  ['is missing', undefined],
  ['is the text "true"', 'true'],
  ['is the number 1', 1],
  ['is null', null],
]) {
  test(`a shop whose verified flag ${label} is not trusted`, () => {
    const d = judge(withFreshbasket({ verified: value }));
    assert.equal(d.verdict, 'block');
    assert.deepEqual(d.reasons, ['MERCHANT_UNVERIFIED']);
    assert.notEqual(d.outcome, 'executed');
  });
}
