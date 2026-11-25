// Time in India Standard Time (UTC+05:30, no daylight saving).
//
// An instant is milliseconds since the epoch. A date is 'YYYY-MM-DD' in IST.
// Everything here is plain arithmetic on those two, so the browser, the Worker
// and Node always agree and nothing depends on the machine's own time zone.

export const IST_OFFSET_MS = 330 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Week order, Monday first. */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const pad2 = (n) => String(n).padStart(2, '0');
const OFFSET_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Accepts milliseconds, or an ISO-8601 string that carries an offset ("Z" or
 * "+05:30"). A string with no offset is refused: it would be read in the
 * machine's own time zone, which is exactly the bug this module exists to avoid.
 */
export function parseInstant(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && OFFSET_SUFFIX.test(value)) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  throw new TypeError(`not an instant with an explicit offset: ${String(value)}`);
}

/** The IST calendar date of an instant. */
export function istDate(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 'mon' .. 'sun' in IST. */
export function istWeekday(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  return WEEKDAYS[(d.getUTCDay() + 6) % 7];
}

/** Checks a 'YYYY-MM-DD' string and returns its parts. Throws for impossible dates such as 2026-02-30. */
export function parseDate(date) {
  const m = typeof date === 'string' ? DATE_ONLY.exec(date) : null;
  if (!m) throw new TypeError(`not a date (YYYY-MM-DD): ${String(date)}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`no such date: ${date}`);
  }
  return { y, m: mo, d };
}

function fromUtcMs(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(date, n) {
  const { y, m, d } = parseDate(date);
  return fromUtcMs(Date.UTC(y, m - 1, d) + n * DAY_MS);
}

/** 00:00:00.000 IST on that date. */
export function dayStart(date) {
  const { y, m, d } = parseDate(date);
  return Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
}

/** 23:59:59.999 IST on that date. */
export function dayEnd(date) {
  return dayStart(addDays(date, 1)) - 1;
}

/**
 * The IST day, week (Monday 00:00 to Sunday 23:59:59.999) or month that holds
 * the instant, as `{start, end}` in milliseconds, both inclusive.
 */
export function windowFor(period, ms) {
  const date = istDate(ms);
  if (period === 'day') return { start: dayStart(date), end: dayEnd(date) };
  if (period === 'week') {
    const monday = addDays(date, -WEEKDAYS.indexOf(istWeekday(ms)));
    return { start: dayStart(monday), end: dayEnd(addDays(monday, 6)) };
  }
  if (period === 'month') {
    const { y, m } = parseDate(date);
    const first = `${String(y).padStart(4, '0')}-${pad2(m)}-01`;
    const next = m === 12 ? `${String(y + 1).padStart(4, '0')}-01-01` : `${String(y).padStart(4, '0')}-${pad2(m + 1)}-01`;
    return { start: dayStart(first), end: dayStart(next) - 1 };
  }
  throw new RangeError(`unknown period: ${String(period)}`);
}
