// The promotion gate compares rates with "strictly below 10%". Floating point
// must not blur that line, so the boundary is checked for many sizes at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPromotion } from '../public/js/core/ladder.js';

const healthy = { single: { events: 400, overrides: 12 }, couple: { events: 300, overrides: 12 }, new_user: { events: 200, overrides: 10 } };

test('a segment at exactly 10% fails and one override fewer passes, for every size from 50 to 2,000 events', () => {
  for (let events = 50; events <= 2000; events += 10) {
    const atLimit = checkPromotion({ from: 'suggest', weeks: 4, segments: { ...healthy, family: { events, overrides: events / 10 } } });
    assert.ok(atLimit.failures.some((f) => f.code === 'SEGMENT_OVER_THRESHOLD' && f.segment === 'family'), `${events / 10}/${events} must fail`);
    const below = checkPromotion({ from: 'suggest', weeks: 4, segments: { ...healthy, family: { events, overrides: events / 10 - 1 } } });
    assert.ok(!below.failures.some((f) => f.segment === 'family'), `${events / 10 - 1}/${events} must pass`);
  }
});

test('odd sizes: 33 of 330, 77 of 770 and 123 of 1,230 are exactly 10% and fail', () => {
  for (const [events, overrides] of [[330, 33], [770, 77], [1230, 123], [510, 51], [990, 99]]) {
    const r = checkPromotion({ from: 'suggest', weeks: 4, segments: { ...healthy, family: { events, overrides } } });
    assert.ok(r.failures.some((f) => f.code === 'SEGMENT_OVER_THRESHOLD'), `${overrides}/${events}`);
  }
});

test('with no events at all the gate stays closed', () => {
  const r = checkPromotion({ from: 'suggest', weeks: 8, segments: {} });
  assert.equal(r.allowed, false);
  assert.ok(r.failures.some((f) => f.code === 'OVERALL_OVER_THRESHOLD'));
});

test('an unknown starting rung is treated as the top: nothing to promote', () => {
  const r = checkPromotion({ from: 'full_autonomy', weeks: 52, consent: true, segments: healthy });
  assert.equal(r.allowed, false);
  assert.deepEqual(r.failures, [{ code: 'TOP_RUNG' }]);
});
