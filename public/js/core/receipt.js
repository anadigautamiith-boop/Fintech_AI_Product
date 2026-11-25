// Receipts: what was decided and why, in plain words.
//
// A receipt is built from a decision and its `figures` by fixed templates. No
// model writes any of it, because an explanation of a payment must never
// contain a fact the engine did not produce. Every rupee amount below is read
// from `figures`; the receipts suite checks this for every policy case.

import { formatRupees } from './money.js';

const PERIOD_PHRASE = { day: 'today', week: 'this week', month: 'this month' };
const PERIOD_ADJECTIVE = { day: 'daily', week: 'weekly', month: 'monthly' };

const REASON_LINES = {
  ASK_ABOVE_THRESHOLD: (f) => `It is above the ${formatRupees(f.askAbove)} you asked to approve yourself.`,
  ASK_POSSIBLE_DUPLICATE: () => 'An order for the same amount at the same shop was paid in the last 30 minutes.',
  ASK_SPLIT_PATTERN: (f) => `Together with another recent order at this shop it would pass your per-order limit of ${formatRupees(f.perOrderCap)}.`,
  ASK_IRREVERSIBLE: () => 'This kind of purchase cannot be undone, so it needs your OK.',
  ASK_NO_RAIL_BACKING: () => 'No payment block is set for this shop, so the bank cannot cap it.',
  MERCHANT_NOT_ALLOWED: (f) => `${f.merchantName} is not on your list of shops.`,
  CATEGORY_NOT_ALLOWED: (f) => `${f.categoryLabel} is not a kind of purchase you allowed.`,
  BLOCKED_DAY: () => 'You blocked purchases on this day of the week.',
  OVER_ORDER_CAP: (f) => `This order is above your per-order limit of ${formatRupees(f.perOrderCap)}.`,
  OVER_PERIOD_CAP: (f) => `Your ${PERIOD_ADJECTIVE[f.period.kind]} limit is ${formatRupees(f.period.cap)} and ${formatRupees(f.period.remainingBefore)} is left, so this order does not fit.`,
  RAIL_BLOCK_EXHAUSTED: (f) => `The payment block for ${f.merchantName} has ${formatRupees(f.rail.remainingBefore)} left, which is not enough.`,
};

/** Decisions that stop before any figures exist: no amounts, nothing to quote. */
const EARLY_STOPS = {
  INVALID_PROPOSAL: { headline: 'Blocked: the order was not valid', line: "The agent's order was missing a shop or a whole-rupee amount." },
  MANDATE_PAUSED: { headline: 'Blocked: agent payments are paused', line: 'You paused this mandate. Resume it to let orders through.' },
  MANDATE_NOT_STARTED: { headline: 'Blocked: your mandate has not started', line: 'This mandate has not started yet.' },
  MANDATE_EXPIRED: { headline: 'Blocked: your mandate has expired', line: 'This mandate has ended. Set a new one to continue.' },
  MERCHANT_UNVERIFIED: { headline: 'Blocked: the shop is not verified', line: 'The shop in this order is not a verified merchant in the catalogue.' },
};

function reasonLines(reasons, figures) {
  return reasons.map((code) => (REASON_LINES[code] ? REASON_LINES[code](figures) : `The rule ${code} applied.`));
}

function limitLines(figures) {
  const lines = [];
  const { period, rail } = figures;
  if (period.cap !== null) {
    lines.push(`${formatRupees(period.remainingAfter)} left of your ${formatRupees(period.cap)} limit ${PERIOD_PHRASE[period.kind]}.`);
  }
  if (rail.limit !== null) {
    lines.push(`${formatRupees(rail.remainingAfter)} left on the payment block for ${figures.merchantName}.`);
  }
  return lines;
}

function undoLine(figures) {
  if (!figures.undo.reversible) return 'This cannot be undone.';
  const n = figures.undo.windowMin;
  return `You can undo this for ${n} ${n === 1 ? 'minute' : 'minutes'}.`;
}

/**
 * @param {{verdict: string, outcome: string, reasons: string[], figures: object|null}} decision
 * @param {{approved?: boolean}} [options] `approved`: a person approved a waiting or suggested order, and it was paid
 * @returns {{headline: string, tone: string, lines: string[], actions: string[], undo: object|null}}
 */
export function buildReceipt(decision, { approved = false } = {}) {
  const { verdict, reasons, figures } = decision;
  const outcome = approved && verdict !== 'block' ? 'executed' : decision.outcome;

  if (!figures) {
    const stop = EARLY_STOPS[reasons[0]] ?? { headline: 'Blocked', line: 'This order could not be checked.' };
    return { headline: stop.headline, tone: 'blocked', lines: [stop.line, 'No money moved.'], actions: [], undo: null };
  }

  const where = figures.merchantName;
  const amount = formatRupees(figures.amount);

  if (outcome === 'executed') {
    const intro = approved ? 'You approved this order.' : 'Why it went ahead: it is inside every limit you set.';
    return {
      headline: `Paid ${amount} to ${where}`,
      tone: 'ok',
      lines: [intro, ...limitLines(figures), undoLine(figures)],
      actions: figures.undo.reversible ? ['undo'] : [],
      undo: { available: figures.undo.reversible, windowMin: figures.undo.windowMin },
    };
  }
  if (outcome === 'awaiting_approval') {
    const why = verdict === 'ask' ? reasonLines(reasons, figures) : ['Your current setting is to approve each order.'];
    return { headline: `Waiting for your OK: ${amount} at ${where}`, tone: 'ask', lines: [...why, 'No money moves until you approve.'], actions: ['approve', 'decline'], undo: null };
  }
  if (outcome === 'suggested') {
    const why = verdict === 'ask' ? reasonLines(reasons, figures) : ['It is inside every limit you set.'];
    return { headline: `Suggestion: ${amount} at ${where}`, tone: 'suggest', lines: [...why, 'No money moved. This is a suggestion only.'], actions: ['approve', 'dismiss'], undo: null };
  }
  return { headline: `Blocked: ${amount} at ${where}`, tone: 'blocked', lines: [...reasonLines(reasons, figures), 'No money moved.'], actions: [], undo: null };
}
