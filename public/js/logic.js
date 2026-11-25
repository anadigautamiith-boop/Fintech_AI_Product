// App logic with no DOM in it, so Node can test it (tests/app-logic.test.js).
// The views in js/views/ only draw what this and the engine in js/core/ decide.

import { CATALOGUE } from './core/catalogue-data.js';
import { MINUTE_MS, WEEKDAYS, addDays, dayStart, istDate, istWeekday } from './core/time.js';
import { formatRupees } from './core/money.js';

export const DEFAULT_INSTRUCTIONS =
  'Weekly ₹3000 for groceries from FreshBasket and QuickMart. Nothing on weekends. Ask me for anything above ₹1000. Max ₹1500 per order. Valid for 2 months.';

export const DEFAULT_FORM = Object.freeze({
  merchants: ['freshbasket', 'quickmart'],
  categories: ['groceries'],
  perOrderCap: '1500',
  periodAmount: '3000',
  periodKind: 'week',
  askAbove: '1000',
  blockedWeekdays: ['sat', 'sun'],
  autoApproveIrreversible: false,
  durationDays: '60',
});

export const SHOPS = Object.entries(CATALOGUE.merchants)
  .filter(([, m]) => m.verified === true)
  .map(([id, m]) => ({ id, name: m.name, category: m.category }));
export const KINDS = Object.entries(CATALOGUE.categories).map(([id, c]) => ({ id, label: c.label }));

export const FIELD_LABEL = {
  merchants: 'Shops',
  categories: 'Kinds of purchase',
  perOrderCap: 'Most for one order',
  periodCap: 'Spending limit',
  blockedWeekdays: 'Days with no buying',
  askAbove: 'Ask me above',
  autoApproveIrreversible: 'Purchases that cannot be undone',
  durationDays: 'How long the rules last',
};

const shopName = (id) => CATALOGUE.merchants[id]?.name ?? id;

export function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------- form and mandate

/** Whole rupees from what a person typed. Anything else is returned as typed, so validation can say what is wrong. */
export function parseAmountText(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim();
  if (s === '') return null;
  const m = /^(?:₹|rs\.?|inr)?\s*(\d[\d,]*)$/i.exec(s);
  return m ? Number(m[1].replace(/,/g, '')) : s;
}

function parseDuration(text) {
  const s = String(text ?? '').trim();
  if (s === '') return null;
  return /^\d+$/.test(s) ? Number(s) : s;
}

/** The form's values as the raw mandate that normalizeMandate checks. */
export function formToRaw(form) {
  const periodAmount = parseAmountText(form.periodAmount);
  return {
    merchants: form.merchants.length ? [...form.merchants] : null,
    categories: form.categories.length ? [...form.categories] : null,
    perOrderCap: parseAmountText(form.perOrderCap),
    periodCap: periodAmount === null ? null : { amount: periodAmount, period: form.periodKind },
    blockedWeekdays: [...form.blockedWeekdays],
    askAbove: parseAmountText(form.askAbove),
    autoApproveIrreversible: Boolean(form.autoApproveIrreversible),
    durationDays: parseDuration(form.durationDays),
  };
}

const text = (n) => (n === null || n === undefined ? '' : String(n));

/**
 * What the mandate reader returned (after coerceParsed) as form values, and
 * anything that must be settled by a person first. A shop that is in the
 * catalogue but not verified cannot go in the form, so it becomes an open item
 * instead of staying in the form where it could not be unticked.
 */
export function readerToForm(result) {
  const { fields, unresolved = [], notes = [] } = result;
  const open = unresolved.map((u) => ({ field: u.field, value: u.value }));
  const merchants = [];
  for (const id of fields.merchants ?? []) {
    if (SHOPS.some((s) => s.id === id)) merchants.push(id);
    else open.push({ field: 'merchants', value: `${shopName(id)} (not a verified shop)` });
  }
  const form = {
    merchants,
    categories: fields.categories ?? [],
    perOrderCap: text(fields.perOrderCap),
    periodAmount: fields.periodCap ? text(fields.periodCap.amount) : '',
    periodKind: fields.periodCap ? fields.periodCap.period : 'week',
    askAbove: text(fields.askAbove),
    blockedWeekdays: [...(fields.blockedWeekdays ?? [])],
    autoApproveIrreversible: fields.autoApproveIrreversible === true,
    durationDays: text(fields.durationDays),
  };
  return { form, unresolved: open.map((u, i) => ({ id: `U${i + 1}`, ...u, message: openItemMessage(u) })), notes };
}

export function openItemMessage({ field, value }) {
  if (field === 'merchants') return `“${value}” is not one of the shops in this simulation.`;
  if (field === 'categories') return `“${value}” is not a kind of purchase this simulation knows.`;
  if (field === '*') return 'The reader’s answer could not be used.';
  return `“${value}” could not be read as “${FIELD_LABEL[field] ?? field}”.`;
}

/** The mandate as short clauses a person would say. */
export function mandateClauses(mandate, formatDate) {
  const clauses = [];
  clauses.push(mandate.merchants ? `Shops: ${joinList(mandate.merchants.map(shopName))}` : 'Shops: any verified shop');
  clauses.push(mandate.categories ? `Kinds: ${joinList(mandate.categories.map((id) => CATALOGUE.categories[id].label.toLowerCase()))}` : 'Kinds: anything');
  if (mandate.perOrderCap !== null) clauses.push(`At most ${formatRupees(mandate.perOrderCap)} per order`);
  if (mandate.periodCap) clauses.push(`At most ${formatRupees(mandate.periodCap.amount)} a ${mandate.periodCap.period}`);
  if (mandate.askAbove !== null) clauses.push(`Asks you above ${formatRupees(mandate.askAbove)}`);
  if (mandate.blockedWeekdays.length) clauses.push(`No buying on ${joinList(mandate.blockedWeekdays.map((d) => dayName(d)))}`);
  if (mandate.autoApproveIrreversible) clauses.push('Buys things that cannot be undone without asking');
  clauses.push(`Runs from ${formatDate(mandate.validFrom)} to ${formatDate(mandate.validUntil)}`);
  return clauses;
}

const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
export const dayName = (d) => DAY_NAMES[d];
export { WEEKDAYS };

// ---------------------------------------------------------------- clock

/** The simulated clock starts at 10:00 IST on a weekday, so the default rules are not blocked on first load. */
export function defaultClock(nowMs) {
  let date = istDate(nowMs);
  for (let i = 0; i < 7; i += 1) {
    const ms = dayStart(date) + 10 * 60 * MINUTE_MS;
    const wd = istWeekday(ms);
    if (wd !== 'sat' && wd !== 'sun') return ms;
    date = addDays(date, 1);
  }
  return dayStart(istDate(nowMs)) + 10 * 60 * MINUTE_MS;
}

/** 10:00 IST on the next given weekday, strictly after `ms`. */
export function nextWeekdayAt10(ms, weekday) {
  let date = istDate(ms);
  for (let i = 0; i < 8; i += 1) {
    const at = dayStart(date) + 10 * 60 * MINUTE_MS;
    if (istWeekday(at) === weekday && at > ms) return at;
    date = addDays(date, 1);
  }
  return ms;
}

// ---------------------------------------------------------------- scripted agent

/**
 * What the scripted agent orders for a sample request. `careful` orders what
 * was asked for; `fooled` orders what a fully steered agent would, for the
 * hostile samples. Benign samples have no trap, so both give the same order.
 */
export function scriptedItems(scenario, mode) {
  if (mode === 'fooled' && scenario.ifSteered) return scenario.ifSteered.items.map((i) => ({ ...i }));
  if (scenario.ideal) return scenario.ideal.map((i) => ({ ...i }));
  return [{ sku: scenario.skus[0], qty: 1 }];
}

// ---------------------------------------------------------------- the ruler

const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const LETTERS = 'ABCDEFGH';

export function niceCeil(x) {
  if (!(x > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(x));
  for (const n of NICE) if (n * exp >= x - 1e-9) return n * exp;
  return 10 * exp;
}

/** The limits that bear on one order, from the engine's figures. */
export function fencesFromFigures(figures) {
  const fences = [];
  if (figures.askAbove !== null) fences.push({ key: 'ask', label: 'Ask me above', value: figures.askAbove, who: 'app', kind: 'ask' });
  if (figures.perOrderCap !== null) fences.push({ key: 'order', label: 'Most for one order', value: figures.perOrderCap, who: 'app', kind: 'limit' });
  if (figures.period.cap !== null) fences.push({ key: 'period', label: `Left this ${figures.period.kind}`, value: figures.period.remainingBefore, who: 'app', kind: 'limit' });
  if (figures.rail.limit !== null) fences.push({ key: 'rail', label: 'Left on the bank’s payment block', value: figures.rail.remainingBefore, who: 'bank', kind: 'limit' });
  return fences;
}

/** The limits as set, before any order. */
export function fencesFromMandate(mandate, compiled) {
  const fences = [];
  if (mandate.askAbove !== null) fences.push({ key: 'ask', label: 'Ask me above', value: mandate.askAbove, who: 'app', kind: 'ask' });
  if (mandate.perOrderCap !== null) fences.push({ key: 'order', label: 'Most for one order', value: mandate.perOrderCap, who: 'app', kind: 'limit' });
  if (mandate.periodCap) fences.push({ key: 'period', label: `Spending limit for a ${mandate.periodCap.period}`, value: mandate.periodCap.amount, who: 'app', kind: 'limit' });
  if (compiled && compiled.blocks.length) fences.push({ key: 'rail', label: 'Payment block at the bank, per shop', value: compiled.blockSize, who: 'bank', kind: 'limit' });
  return fences;
}

/**
 * Positions for the ruler. The axis ends a little past the order and the limits
 * near it; a limit far beyond that is listed but not drawn, so the small
 * numbers stay readable.
 */
export function rulerModel({ fences, amount = null }) {
  const live = fences.filter((f) => Number.isFinite(f.value) && f.value >= 0);
  const positive = live.filter((f) => f.value > 0).map((f) => f.value);
  const smallest = positive.length ? Math.min(...positive) : 0;
  const base = Math.max(amount ?? 0, smallest);
  const near = base > 0 ? live.filter((f) => f.value <= 3 * base) : live;
  const far = live.filter((f) => !near.includes(f));
  const max = niceCeil(Math.max(amount ?? 0, ...near.map((f) => f.value), 1) * 1.12);
  const byValue = (a, b) => a.value - b.value;
  const mark = (f, i) => ({ ...f, letter: LETTERS[i] ?? '?', crossed: amount !== null && amount > f.value });
  const placed = [...near].sort(byValue).map((f, i) => ({ ...mark(f, i), pct: Math.min(100, (f.value / max) * 100) }));
  const offScale = [...far].sort(byValue).map((f, i) => ({ ...mark(f, placed.length + i), pct: null }));
  const over = [...placed, ...offScale].some((f) => f.kind === 'limit' && f.crossed);
  return { max, amount, pin: amount === null ? null : { value: amount, pct: Math.min(100, (amount / max) * 100), over }, fences: placed, offScale };
}

/** The sentence for one limit in the ruler's legend. */
export function fenceText(f, amount) {
  const who = f.who === 'bank' ? 'held by the bank, checked again by this app' : 'checked by this app';
  let main = `${f.label}: ${formatRupees(f.value)}`;
  if (amount !== null && f.crossed) {
    main += f.kind === 'ask' ? '. This order is above it, so you are asked.' : `. This order is ${formatRupees(amount - f.value)} over.`;
  }
  return { main, who };
}
