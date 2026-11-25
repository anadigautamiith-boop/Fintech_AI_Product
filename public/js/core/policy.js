// The policy engine. Plain code, no model, no I/O: the same inputs always give
// the same decision. docs/SPEC.md section 6 is the contract.
//
// The proposal is untrusted. It is read for exactly two things, `merchantId`
// and `amount`; every other field (a claimed category, approval, rung or time)
// is ignored. Category comes from the catalogue, time from `now`, and the
// autonomy rung from the caller.

import { istWeekday, windowFor, dayStart, dayEnd, MINUTE_MS } from './time.js';
import { isPositiveSafeInt } from './money.js';
import { getCategory, getMerchant, has } from './catalogue.js';

export const DUPLICATE_WINDOW_MS = 30 * MINUTE_MS;
export const SPLIT_WINDOW_MS = 60 * MINUTE_MS;

/** Rung to outcome for each verdict (spec section 7). A block never executes. */
const ROUTING = {
  suggest: { allow: 'suggested', ask: 'suggested', block: 'blocked' },
  approve_each: { allow: 'awaiting_approval', ask: 'awaiting_approval', block: 'blocked' },
  bounded: { allow: 'executed', ask: 'awaiting_approval', block: 'blocked' },
};

/** An unknown rung is treated as the most cautious one: suggestions only. */
export function routeOutcome(verdict, rung) {
  const row = has(ROUTING, rung) ? ROUTING[rung] : ROUTING.suggest;
  return row[verdict];
}

function decision(verdict, reasons, figures, rung) {
  return { verdict, outcome: routeOutcome(verdict, rung), reasons, figures };
}

function readProposal(proposal) {
  if (proposal === null || typeof proposal !== 'object' || Array.isArray(proposal)) return null;
  if (!has(proposal, 'merchantId') || !has(proposal, 'amount')) return null;
  const { merchantId, amount } = proposal;
  if (typeof merchantId !== 'string' || merchantId.length === 0) return null;
  if (!isPositiveSafeInt(amount)) return null;
  return { merchantId, amount };
}

const sum = (orders) => orders.reduce((total, o) => total + o.amount, 0);

/**
 * @param {object} input
 * @param {object} input.mandate a normalised mandate
 * @param {object} input.compiled the compiled mandate (rail blocks)
 * @param {{paused: boolean, ledger: object[], railUsed: object}} input.state
 * @param {*} input.proposal untrusted
 * @param {number} input.now milliseconds since the epoch, from the app clock
 * @param {object} input.catalogue
 * @param {string} input.rung 'suggest' | 'approve_each' | 'bounded'
 * @returns {{verdict: 'allow'|'ask'|'block', outcome: string, reasons: string[], figures: object|null}}
 */
export function evaluate({ mandate, compiled, state, proposal, now, catalogue, rung }) {
  // 1. A proposal that is not a shop and a whole-rupee amount is not an order.
  const order = readProposal(proposal);
  if (!order) return decision('block', ['INVALID_PROPOSAL'], null, rung);
  const { merchantId, amount } = order;

  // 2. Paused.
  if (state.paused) return decision('block', ['MANDATE_PAUSED'], null, rung);

  // 3. The mandate's own dates, inclusive of the whole first and last day.
  if (now < dayStart(mandate.validFrom)) return decision('block', ['MANDATE_NOT_STARTED'], null, rung);
  if (now > dayEnd(mandate.validUntil)) return decision('block', ['MANDATE_EXPIRED'], null, rung);

  // 4. The shop must be in the catalogue and verified. No trimming, no case folding.
  const merchant = getMerchant(catalogue, merchantId);
  if (!merchant || merchant.verified !== true) return decision('block', ['MERCHANT_UNVERIFIED'], null, rung);
  const category = getCategory(catalogue, merchant.category);

  // Figures: computed once, used by the rules below and by the receipt.
  const period = { kind: null, cap: null, spentBefore: 0, remainingBefore: null, remainingAfter: null };
  if (mandate.periodCap) {
    const window = windowFor(mandate.periodCap.period, now);
    const spentBefore = sum(state.ledger.filter((o) => o.status === 'paid' && o.ts >= window.start && o.ts <= window.end));
    const cap = mandate.periodCap.amount;
    Object.assign(period, {
      kind: mandate.periodCap.period,
      cap,
      spentBefore,
      remainingBefore: Math.max(0, cap - spentBefore),
      remainingAfter: Math.max(0, cap - spentBefore - amount),
    });
  }
  const block = compiled.blocks.find((b) => b.merchantId === merchantId) ?? null;
  const used = has(state.railUsed, merchantId) ? state.railUsed[merchantId] : 0;
  const rail = { limit: null, used, remainingBefore: null, remainingAfter: null };
  if (block) {
    Object.assign(rail, {
      limit: block.limit,
      remainingBefore: Math.max(0, block.limit - used),
      remainingAfter: Math.max(0, block.limit - used - amount),
    });
  }
  const figures = {
    amount,
    merchantId,
    merchantName: merchant.name,
    category: merchant.category,
    categoryLabel: category.label,
    perOrderCap: mandate.perOrderCap,
    askAbove: mandate.askAbove,
    period,
    rail,
    undo: { reversible: category.reversible, windowMin: category.undoWindowMin },
  };

  // 5. Hard rules. Every one that applies is reported, in this order.
  const hard = [];
  if (mandate.merchants && !mandate.merchants.includes(merchantId)) hard.push('MERCHANT_NOT_ALLOWED');
  if (mandate.categories && !mandate.categories.includes(merchant.category)) hard.push('CATEGORY_NOT_ALLOWED');
  if (mandate.blockedWeekdays.includes(istWeekday(now))) hard.push('BLOCKED_DAY');
  if (mandate.perOrderCap !== null && amount > mandate.perOrderCap) hard.push('OVER_ORDER_CAP');
  if (period.cap !== null && period.spentBefore + amount > period.cap) hard.push('OVER_PERIOD_CAP');
  if (block && amount > block.limit - used) hard.push('RAIL_BLOCK_EXHAUSTED');
  if (hard.length) return decision('block', hard, figures, rung);

  // 6. Soft rules. Every one that applies is reported, in this order.
  const soft = [];
  const paidHere = state.ledger.filter((o) => o.status === 'paid' && o.merchantId === merchantId);
  const age = (o) => now - o.ts;
  if (mandate.askAbove !== null && amount > mandate.askAbove) soft.push('ASK_ABOVE_THRESHOLD');
  if (paidHere.some((o) => o.amount === amount && age(o) >= 0 && age(o) <= DUPLICATE_WINDOW_MS)) soft.push('ASK_POSSIBLE_DUPLICATE');
  if (mandate.perOrderCap !== null) {
    const recent = paidHere.filter((o) => age(o) >= 0 && age(o) <= SPLIT_WINDOW_MS);
    if (recent.length >= 1 && sum(recent) + amount > mandate.perOrderCap) soft.push('ASK_SPLIT_PATTERN');
  }
  if (!category.reversible && !mandate.autoApproveIrreversible) soft.push('ASK_IRREVERSIBLE');
  if (!block) soft.push('ASK_NO_RAIL_BACKING');
  if (soft.length) return decision('ask', soft, figures, rung);

  // 7. Everything is inside the limits.
  return decision('allow', [], figures, rung);
}
