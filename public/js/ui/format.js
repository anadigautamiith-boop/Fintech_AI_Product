// Dates, times and numbers as people in India read them. Every instant is shown
// in IST, whatever the browser's own time zone.

import { IST_OFFSET_MS, istDate, istWeekday } from '../core/time.js';
export { formatRupees as rupees } from '../core/money.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY_LABEL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
export const DAY_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

const pad2 = (n) => String(n).padStart(2, '0');

export function istParts(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes(), weekday: istWeekday(ms), date: istDate(ms) };
}

/** "Tue 1 Dec 2026, 10:00" */
export function formatTime(ms) {
  const p = istParts(ms);
  return `${DAY_SHORT[p.weekday]} ${p.day} ${MONTHS[p.month]} ${p.year}, ${pad2(p.hh)}:${pad2(p.mm)}`;
}

/** "1 Dec, 10:00" */
export function formatShort(ms) {
  const p = istParts(ms);
  return `${p.day} ${MONTHS[p.month]}, ${pad2(p.hh)}:${pad2(p.mm)}`;
}

/** 'YYYY-MM-DD' to "1 Dec 2026" */
export function formatDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The value of a datetime-local input, read as IST. */
export function toLocalInput(ms) {
  const p = istParts(ms);
  return `${p.year}-${pad2(p.month + 1)}-${pad2(p.day)}T${pad2(p.hh)}:${pad2(p.mm)}`;
}

export function fromLocalInput(text) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}:00+05:30`);
  return Number.isNaN(ms) ? null : ms;
}

export function percent(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  return `${(x * 100).toFixed(digits).replace(/\.0+$/, '')}%`;
}
