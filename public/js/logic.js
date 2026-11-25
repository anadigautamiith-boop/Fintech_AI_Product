// App logic with no DOM in it, so Node can test it (tests/app-logic.test.js).
// The views in js/views/ only draw what this and the engine in js/core/ decide.

import { CATALOGUE } from './core/catalogue-data.js';
import { MINUTE_MS, WEEKDAYS, addDays, dayStart, istDate, istWeekday, windowFor } from './core/time.js';
import { formatRupees } from './core/money.js';
import { buildReceipt } from './core/receipt.js';
import { DEFAULT_MIN_EVENTS, DEFAULT_THRESHOLD, RUNG_LABELS, STEPS } from './core/ladder.js';
import { percent } from './ui/format.js';

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

/** Rule sets a person can start from. They match the mandates the labelled test cases use, so a sample request runs under the rules it was written for. */
export const PRESETS = Object.freeze([
  { id: 'groceries', label: 'Groceries every week', mandate: 'M_GROC', instructions: DEFAULT_INSTRUCTIONS, form: DEFAULT_FORM },
  {
    id: 'food',
    label: 'Food delivery',
    mandate: 'M_FOOD',
    instructions: 'Up to ₹2000 a week on food delivery from SpiceRoute Kitchen and Biryani Lane. Max ₹800 per order. Valid for 2 months.',
    form: Object.freeze({ merchants: ['spiceroute', 'biryanilane'], categories: ['food_delivery'], perOrderCap: '800', periodAmount: '2000', periodKind: 'week', askAbove: '', blockedWeekdays: [], autoApproveIrreversible: false, durationDays: '60' }),
  },
  {
    id: 'recharge',
    label: 'Mobile recharge',
    mandate: 'M_RECHARGE_AUTO',
    instructions: 'One mobile recharge a month from TeleTop, up to ₹799. Go ahead without asking me. Valid for 2 months.',
    form: Object.freeze({ merchants: ['teletop'], categories: ['mobile_recharge'], perOrderCap: '799', periodAmount: '799', periodKind: 'month', askAbove: '', blockedWeekdays: [], autoApproveIrreversible: true, durationDays: '60' }),
  },
]);

export const presetById = (id) => PRESETS.find((p) => p.id === id) ?? null;

/** Two forms hold the same rules (the order of shops and days does not matter). */
export function sameForm(a, b) {
  if (!a || !b) return false;
  const norm = (f) => JSON.stringify(Object.keys(DEFAULT_FORM).map((k) => (Array.isArray(f[k]) ? [...f[k]].sort() : f[k])));
  return norm(a) === norm(b);
}

/** The preset a sample request was written for (the test file names a mandate, or uses its default). */
export function presetForScenario(scenario, defaults) {
  const mandate = scenario.mandate ?? defaults.mandate;
  return PRESETS.find((p) => p.mandate === mandate) ?? null;
}

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
  const who = f.who === 'bank' ? 'Held by the bank, and checked again by Reins.' : 'Checked by Reins only.';
  let main = `${f.label}: ${formatRupees(f.value)}.`;
  if (amount !== null && f.crossed) {
    main += f.kind === 'ask' ? ' This order is above it, so you are asked.' : ` This order is ${formatRupees(amount - f.value)} over.`;
  }
  return { main, who };
}

// ---------------------------------------------------------------- receipt slips

export const BUILD_ERROR_TEXT = {
  NO_ITEMS: 'The assistant did not choose any items.',
  TOO_MANY_LINES: 'The assistant listed more than 20 different items.',
  UNKNOWN_SKU: 'The assistant named an item that is not in the shop catalogue.',
  BAD_QTY: 'An item had a quantity that is not a whole number from 1 to 99.',
  MIXED_MERCHANTS: 'The items came from more than one shop, and one order is paid to one shop.',
};

const STAMP = {
  paid: { text: 'Paid', tone: 'ok' },
  refunded: { text: 'Refunded', tone: 'quiet' },
  awaiting_approval: { text: 'Needs your OK', tone: 'ask' },
  suggested: { text: 'Suggested', tone: 'stamp' },
  blocked: { text: 'Blocked', tone: 'block' },
  blocked_on_approval: { text: 'Blocked', tone: 'block' },
  declined: { text: 'Declined', tone: 'quiet' },
  dismissed: { text: 'Dismissed', tone: 'quiet' },
  not_built: { text: 'Not an order', tone: 'block' },
};

/**
 * Whether a paid order can still be undone, and the minutes left, by the same
 * test the engine applies: it refuses only when MORE than the window has passed.
 * @returns {{open: boolean, minutesLeft: number, windowMin: number}|null} null when the order cannot be undone at all
 */
export function undoStatus(entry, ledger, now) {
  const order = ledger.find((o) => o.id === entry.orderId);
  const u = entry.decision?.figures?.undo;
  if (!order || !u || !u.reversible) return null;
  const left = u.windowMin * MINUTE_MS - (now - order.ts);
  return { open: left >= 0, minutesLeft: left <= 0 ? 0 : Math.ceil(left / MINUTE_MS), windowMin: u.windowMin };
}

/**
 * Everything a receipt slip shows for one entry in the feed, worked out from
 * what the engine decided. The screen only draws this. Words that carry a
 * rupee amount come from the engine's own receipt or from the order's lines.
 */
export function slipModel(entry, { ledger, now }) {
  const stamp = STAMP[entry.status] ?? { text: entry.status, tone: 'quiet' };
  const items = entry.proposal ? entry.proposal.items : null;
  const base = { stamp, items, total: entry.proposal ? entry.proposal.amount : null, figures: entry.decision?.figures ?? null, undo: null, notes: entry.notes ?? [] };

  if (entry.status === 'not_built') {
    return { ...base, headline: 'No order was made', lines: [...entry.errors.map((c) => BUILD_ERROR_TEXT[c] ?? `The order could not be read (${c}).`), 'Nothing was checked or paid.'], actions: [] };
  }

  const figures = entry.decision?.figures;
  const shop = figures ? figures.merchantName : null;
  const amount = entry.proposal ? formatRupees(entry.proposal.amount) : null;

  if (entry.status === 'refunded') {
    const lines = ['You undid this order inside its undo window.', 'It no longer counts toward your spending limit.', 'The bank’s payment block is not restored in this simulation.'];
    return { ...base, headline: `Refunded ${amount} from ${shop}`, lines, actions: [] };
  }
  if (entry.status === 'declined' || entry.status === 'dismissed') {
    const verb = entry.status === 'declined' ? 'Declined' : 'Dismissed';
    return { ...base, headline: `${verb}: ${amount} at ${shop}`, lines: ['No money moved.'], actions: [] };
  }

  const receipt = buildReceipt(entry.decision, { approved: entry.approved });
  const model = { ...base, headline: receipt.headline, lines: receipt.lines, actions: receipt.actions };
  if (entry.status === 'paid') {
    model.undo = undoStatus(entry, ledger, now);
    model.actions = model.undo && model.undo.open ? ['undo'] : [];
  }
  return model;
}


// ---------------------------------------------------------------- statement

/** How much of the period limit is spent now, counted the way the engine counts it. */
export function periodStatus(mandate, ledger, now) {
  if (!mandate || !mandate.periodCap) return null;
  const { period, amount: cap } = mandate.periodCap;
  const window = windowFor(period, now);
  const spent = ledger.filter((o) => o.status === 'paid' && o.ts >= window.start && o.ts <= window.end).reduce((total, o) => total + o.amount, 0);
  return { period, cap, spent, left: Math.max(0, cap - spent) };
}


// ---------------------------------------------------------------- the promotion gate

const weeksText = (n) => `${n} ${n === 1 ? 'week' : 'weeks'}`;

/**
 * The gate's failures in plain words. `labels` maps a segment id to its name.
 * @param {{from: string, weeks: number, gate: object, labels: {[id: string]: string}}} input
 * @returns {{code: string, segment?: string, text: string}[]}
 */
export function gateReasons({ from, weeks, gate, labels }) {
  const step = STEPS[from] ?? null;
  const line = Math.round(DEFAULT_THRESHOLD * 100);
  return gate.failures.map((f) => {
    const seg = f.segment ? gate.bySegment[f.segment] : null;
    const name = f.segment ? labels[f.segment] ?? f.segment : null;
    switch (f.code) {
      case 'TOO_SHORT': return { ...f, text: `Only ${weeksText(weeks)} of record. Moving up from “${RUNG_LABELS[from]}” needs at least ${weeksText(step.minWeeks)}.` };
      case 'NO_CONSENT': return { ...f, text: `Moving up to “${RUNG_LABELS[step.to]}” needs your consent. Tick the box.` };
      case 'INSUFFICIENT_DATA': return { ...f, text: `${name}: only ${seg.events} orders so far. At least ${DEFAULT_MIN_EVENTS} are needed before this group can be judged.` };
      case 'SEGMENT_OVER_THRESHOLD': return { ...f, text: `${name}: people overrode the assistant on ${percent(seg.rate)} of orders. The line is ${line}%.` };
      case 'OVERALL_OVER_THRESHOLD': return { ...f, text: gate.overall.rate === null ? 'There are no orders in the record yet.' : `Overall, people overrode the assistant on ${percent(gate.overall.rate)} of orders. The line is ${line}%.` };
      case 'TOP_RUNG': return { ...f, text: 'The assistant is already at the top rung. There is nothing higher.' };
      default: return { ...f, text: `The check ${f.code} did not pass.` };
    }
  });
}

/**
 * The case the gate exists for: the overall rate is under the line and one
 * group is over it. Returns a sentence, or null when that is not what happened.
 */
export function hiddenGapText({ gate, labels }) {
  const bad = gate.failures.filter((f) => f.code === 'SEGMENT_OVER_THRESHOLD');
  if (!bad.length || gate.overall.rate === null || !(gate.overall.rate < DEFAULT_THRESHOLD)) return null;
  const names = bad.map((f) => `${labels[f.segment] ?? f.segment} (${percent(gate.bySegment[f.segment].rate)})`);
  return `Overall, only ${percent(gate.overall.rate)} of orders were overridden, under the ${Math.round(DEFAULT_THRESHOLD * 100)}% line. ${joinList(names)} ${bad.length === 1 ? 'is' : 'are'} over it. The average hides the problem, so the gate says no.`;
}
