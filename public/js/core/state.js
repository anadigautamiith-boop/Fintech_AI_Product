// State changes. The policy engine only reads state; these functions are the
// only way it changes, and each returns a new state instead of editing the old
// one. docs/SPEC.md section 6.5.

import { evaluate } from './policy.js';
import { categoryOf, getCategory } from './catalogue.js';
import { MINUTE_MS } from './time.js';

export function newState() {
  return { paused: false, ledger: [], railUsed: {} };
}

export function setPaused(state, paused) {
  return { ...state, paused: Boolean(paused) };
}

/** Add a paid order. Rail use is gross: it only ever goes up. */
export function recordOrder(state, { merchantId, amount, ts }, catalogue) {
  const order = {
    id: `O${state.ledger.length + 1}`,
    merchantId,
    category: categoryOf(catalogue, merchantId),
    amount,
    ts,
    status: 'paid',
  };
  return {
    ...state,
    ledger: [...state.ledger, order],
    railUsed: { ...state.railUsed, [merchantId]: (state.railUsed[merchantId] ?? 0) + amount },
  };
}

/**
 * Undo an order inside its category's window. The order becomes `refunded`,
 * which frees the period spend; the rail block is not restored (the refund
 * rule is an assumption, spec section 3).
 */
export function undoOrder(state, orderId, now, catalogue) {
  const order = state.ledger.find((o) => o.id === orderId);
  if (!order) return { ok: false, reason: 'UNKNOWN_ORDER' };
  if (order.status === 'refunded') return { ok: false, reason: 'ALREADY_REFUNDED' };
  const category = getCategory(catalogue, order.category);
  if (!category || !category.reversible) return { ok: false, reason: 'NOT_REVERSIBLE' };
  if (now - order.ts > category.undoWindowMin * MINUTE_MS) return { ok: false, reason: 'UNDO_WINDOW_CLOSED' };
  return {
    ok: true,
    state: { ...state, ledger: state.ledger.map((o) => (o.id === orderId ? { ...o, status: 'refunded' } : o)) },
  };
}

/**
 * A person approves a proposal that was waiting or only suggested. The checks
 * run again at `now`: the clock, the ledger, the pause switch and the mandate
 * may all have changed since the proposal was made. Only a `block` verdict
 * stops the order; an `ask` is what the person has just answered.
 */
export function approveOrder({ mandate, compiled, state, proposal, now, catalogue }) {
  const decision = evaluate({ mandate, compiled, state, proposal, now, catalogue, rung: 'bounded' });
  if (decision.verdict === 'block') return { executed: false, decision, state };
  const next = recordOrder(state, { merchantId: proposal.merchantId, amount: proposal.amount, ts: now }, catalogue);
  return { executed: true, decision, state: next };
}
