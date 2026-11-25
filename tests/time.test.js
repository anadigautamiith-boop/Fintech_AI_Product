// The engine's date arithmetic is checked against Intl, which knows the Indian time zone.
// A fixed seed makes the sample reproducible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInstant, istDate, istWeekday, addDays, dayStart, dayEnd, windowFor, WEEKDAYS } from '../public/js/core/time.js';
import { formatRupees, isMandateAmount, isPositiveSafeInt } from '../public/js/core/money.js';

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
function intlParts(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday.toLowerCase().slice(0, 3) };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('istDate and istWeekday agree with Intl for 5,000 instants between 2026 and 2029', () => {
  const rand = mulberry32(2026);
  const from = Date.parse('2026-01-01T00:00:00Z');
  const span = Date.parse('2029-12-31T00:00:00Z') - from;
  for (let i = 0; i < 5000; i += 1) {
    const ms = from + Math.floor(rand() * span);
    const want = intlParts(ms);
    assert.equal(istDate(ms), want.date, `date at ${new Date(ms).toISOString()}`);
    assert.equal(istWeekday(ms), want.weekday, `weekday at ${new Date(ms).toISOString()}`);
  }
});

test('day boundaries are midnight IST, to the millisecond', () => {
  assert.equal(dayStart('2026-12-05'), Date.parse('2026-12-04T18:30:00Z'));
  assert.equal(dayEnd('2026-12-05'), Date.parse('2026-12-05T18:29:59.999Z'));
  assert.equal(istDate(dayStart('2026-12-05')), '2026-12-05');
  assert.equal(istDate(dayStart('2026-12-05') - 1), '2026-12-04');
  assert.equal(istDate(dayEnd('2026-12-05')), '2026-12-05');
  assert.equal(istDate(dayEnd('2026-12-05') + 1), '2026-12-06');
});

test('windowFor: a week runs Monday 00:00 to Sunday 23:59:59.999 IST', () => {
  const rand = mulberry32(7);
  const from = Date.parse('2026-06-01T00:00:00Z');
  for (let i = 0; i < 2000; i += 1) {
    const ms = from + Math.floor(rand() * 400 * 86400000);
    const w = windowFor('week', ms);
    assert.ok(w.start <= ms && ms <= w.end, 'window holds the instant');
    assert.equal(istWeekday(w.start), 'mon');
    assert.equal(istWeekday(w.end), 'sun');
    assert.equal(w.end - w.start + 1, 7 * 86400000);
    assert.equal(istDate(w.start) <= istDate(ms), true);
  }
});

test('windowFor: a month is the IST calendar month, including February in a leap year', () => {
  const feb = windowFor('month', Date.parse('2028-02-15T10:00:00+05:30'));
  assert.equal(istDate(feb.start), '2028-02-01');
  assert.equal(istDate(feb.end), '2028-02-29');
  const dec = windowFor('month', Date.parse('2026-12-31T23:59:59+05:30'));
  assert.equal(istDate(dec.start), '2026-12-01');
  assert.equal(dec.end, dayEnd('2026-12-31'));
  const justAfter = windowFor('month', Date.parse('2027-01-01T00:00:00+05:30'));
  assert.equal(istDate(justAfter.start), '2027-01-01');
});

test('windowFor: a day is the IST day, not the UTC day', () => {
  const w = windowFor('day', Date.parse('2026-12-01T18:40:00Z')); // 00:10 on 2 December in IST
  assert.equal(istDate(w.start), '2026-12-02');
  assert.equal(w.start, Date.parse('2026-12-01T18:30:00Z'));
});

test('addDays crosses month, year and leap-day boundaries', () => {
  assert.equal(addDays('2026-11-30', 59), '2027-01-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(WEEKDAYS.length, 7);
});

test('parseInstant refuses a time with no offset and an impossible date', () => {
  assert.equal(parseInstant('2026-12-01T10:00:00+05:30'), Date.parse('2026-12-01T04:30:00Z'));
  assert.equal(parseInstant('2026-12-01T04:30:00Z'), Date.parse('2026-12-01T04:30:00Z'));
  assert.equal(parseInstant(1234), 1234);
  assert.throws(() => parseInstant('2026-12-01T10:00:00'), TypeError);
  assert.throws(() => parseInstant('yesterday'), TypeError);
  assert.throws(() => parseInstant(Number.NaN), TypeError);
  assert.throws(() => addDays('2026-02-30', 1), RangeError);
  assert.throws(() => addDays('2026-2-3', 1), TypeError);
});

test('formatRupees uses Indian digit grouping and refuses non-integers', () => {
  const cases = [[0, '₹0'], [7, '₹7'], [999, '₹999'], [1000, '₹1,000'], [1200, '₹1,200'], [10000, '₹10,000'], [99999, '₹99,999'], [100000, '₹1,00,000'], [1234567, '₹12,34,567'], [10000000, '₹1,00,00,000'], [-1500, '-₹1,500']];
  for (const [n, text] of cases) assert.equal(formatRupees(n), text);
  assert.throws(() => formatRupees(1.5), TypeError);
  assert.throws(() => formatRupees(Number.NaN), TypeError);
  assert.throws(() => formatRupees('500'), TypeError);
});

test('amount checks: mandate amounts are 1 to 1,000,000; proposal amounts are any positive safe integer', () => {
  assert.equal(isMandateAmount(1), true);
  assert.equal(isMandateAmount(1000000), true);
  for (const bad of [0, -1, 1000001, 1.5, '5', null, undefined, Number.NaN, true]) assert.equal(isMandateAmount(bad), false, String(bad));
  assert.equal(isPositiveSafeInt(10000000), true);
  for (const bad of [0, -5, 1e21, 999.99, '500', null, Number.MAX_SAFE_INTEGER + 2]) assert.equal(isPositiveSafeInt(bad), false, String(bad));
});
