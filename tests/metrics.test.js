import test from 'node:test';
import assert from 'node:assert/strict';
import { orderMetrics, modelUsage, NOT_MEASURED } from '../public/js/core/metrics.js';
import { newState, recordOrder, undoOrder } from '../public/js/core/state.js';
import { CATALOGUE } from '../public/js/core/catalogue-data.js';

const T0 = Date.parse('2026-12-01T10:00:00+05:30');
const MIN = 60_000;

test('no orders: shares are null, not 0 or 100', () => {
  assert.deepEqual(orderMetrics(newState()), { executed: 0, kept: 0, refunded: 0, keptShare: null, reversalRate: null });
});

test('kept share and reversal rate come from the ledger and add up to 1', () => {
  let s = newState();
  for (let i = 0; i < 4; i += 1) s = recordOrder(s, { merchantId: 'freshbasket', amount: 100 + i, ts: T0 + i * 120 * MIN }, CATALOGUE);
  const undone = undoOrder(s, 'O2', T0 + 120 * MIN + 5 * MIN, CATALOGUE);
  assert.equal(undone.ok, true);
  const m = orderMetrics(undone.state);
  assert.deepEqual(m, { executed: 4, kept: 3, refunded: 1, keptShare: 0.75, reversalRate: 0.25 });
  assert.equal(m.keptShare + m.reversalRate, 1);
});

test('a refused undo changes nothing', () => {
  let s = newState();
  s = recordOrder(s, { merchantId: 'teletop', amount: 399, ts: T0 }, CATALOGUE);
  const refused = undoOrder(s, 'O1', T0 + MIN, CATALOGUE);
  assert.equal(refused.ok, false);
  assert.equal(orderMetrics(s).keptShare, 1);
});

test('model usage adds up the calls that reported tokens and counts the rest', () => {
  const u = modelUsage([
    { promptTokens: 1000, completionTokens: 200 },
    { promptTokens: 800, completionTokens: 100 },
    {},
    { promptTokens: -5, completionTokens: 10 },
    null,
  ]);
  assert.deepEqual(u, { calls: 5, reported: 2, promptTokens: 1800, completionTokens: 300, tokensPerCall: 1050 });
});

test('model usage with no reports gives null, not NaN', () => {
  assert.equal(modelUsage([]).tokensPerCall, null);
  assert.equal(modelUsage([{}]).tokensPerCall, null);
});

test('complaints are listed as not measured', () => {
  assert.ok(NOT_MEASURED.some((x) => x.includes('complaints')));
});
