// The app's state, and every change to it. No DOM here: Node tests drive the
// whole flow (tests/store.test.js). The engine in js/core/ decides; this file
// only keeps what it decided and saves it in the browser, if storage works.

import { CATALOGUE } from './core/catalogue-data.js';
import { istDate, istWeekday } from './core/time.js';
import { normalizeMandate } from './core/mandate.js';
import { compileMandate } from './core/rail.js';
import { evaluate } from './core/policy.js';
import { approveOrder, newState, recordOrder, setPaused, undoOrder } from './core/state.js';
import { buildProposal } from './core/proposal.js';
import { checkPromotion } from './core/ladder.js';
import { generateShadowEvents, summarizeEvents } from './core/shadow.js';
import { orderMetrics } from './core/metrics.js';
import { isSteered } from './core/model-eval.js';
import { DEFAULT_FORM, DEFAULT_INSTRUCTIONS, defaultClock, formToRaw } from './logic.js';

const KEY = 'reins.v1';
export const SHADOW_SEED = 7;
export const SHADOW_EVENTS_PER_WEEK = 250;
export const BANK_CHOICES = [1, 2, 3];

function initial(nowMs = Date.now()) {
  return {
    v: 1,
    clockMs: defaultClock(nowMs),
    instructions: DEFAULT_INSTRUCTIONS,
    form: structuredClone(DEFAULT_FORM),
    unresolved: [],
    notes: [],
    mandate: null,
    bankSlots: 2,
    rung: 'suggest',
    ledgerState: newState(),
    feed: [],
    nextFeedId: 1,
    evidence: { set: 'healthy', weeks: 4, consent: false },
  };
}

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function load() {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    const ok = s && s.v === 1 && Array.isArray(s.feed) && s.ledgerState && Array.isArray(s.ledgerState.ledger) && s.form && Number.isFinite(s.clockMs);
    return ok ? s : null;
  } catch {
    return null;
  }
}

let S = load() ?? initial();
const listeners = new Set();

function persist() {
  try {
    storage()?.setItem(KEY, JSON.stringify(S));
  } catch {
    /* storage can be full or blocked; the app still works for this visit */
  }
}

function commit(patch) {
  S = { ...S, ...patch };
  persist();
  for (const fn of [...listeners]) fn(S);
}

export const get = () => S;
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** For tests: start again from a clean state. */
export function reset(nowMs) {
  S = initial(nowMs);
  persist();
  for (const fn of [...listeners]) fn(S);
}

// ---------------------------------------------------------------- derived

export function compiled(state = S) {
  return state.mandate ? compileMandate(state.mandate, { maxActiveBlocks: state.bankSlots }) : null;
}

/** The form's current rules as the engine would read them (or the errors). */
export function checkForm(state = S) {
  return normalizeMandate(formToRaw(state.form), { today: istDate(state.clockMs), catalogue: CATALOGUE });
}

export function metrics(state = S) {
  return orderMetrics(state.ledgerState);
}

export function blockedToday(state = S) {
  return Boolean(state.mandate && state.mandate.blockedWeekdays.includes(istWeekday(state.clockMs)));
}

export function evidence(state = S) {
  const { set, weeks, consent } = state.evidence;
  const summary = summarizeEvents(generateShadowEvents({ set, seed: SHADOW_SEED, weeks, eventsPerWeek: SHADOW_EVENTS_PER_WEEK }));
  const gate = checkPromotion({ from: state.rung, weeks, consent, segments: summary.segments });
  return { summary, gate };
}

// ---------------------------------------------------------------- clock

export const setClock = (ms) => commit({ clockMs: ms });
export const advanceClock = (ms) => commit({ clockMs: S.clockMs + ms });

// ---------------------------------------------------------------- rules

export const setInstructions = (instructions) => commit({ instructions });
export const setForm = (patch) => commit({ form: { ...S.form, ...patch } });
export const setBankSlots = (bankSlots) => commit({ bankSlots });

/** The reader's answer replaces the form; open items must be settled before the rules can be activated. */
export function applyReader({ form, unresolved, notes }) {
  commit({ form, unresolved, notes });
}

export function dismissOpenItem(id) {
  commit({ unresolved: S.unresolved.filter((u) => u.id !== id) });
}

/** @returns {{ok: boolean, errors: object[], warnings: object[]}} */
export function activate() {
  if (S.unresolved.length) {
    return { ok: false, warnings: [], errors: [{ code: 'OPEN_ITEMS', field: null, message: 'Settle the open items from the reader first: fix them in the form or dismiss each one on purpose.' }] };
  }
  const r = checkForm();
  if (!r.ok) return r;
  // Activating asks the bank for fresh payment blocks, so what the old blocks had used is not carried over.
  // Only the person can do this: no order, and no model, can create a block. Past orders still count toward the period limit.
  commit({ mandate: r.mandate, ledgerState: { ...S.ledgerState, railUsed: {} } });
  return r;
}

// ---------------------------------------------------------------- orders

const lastOrderId = (state) => state.ledger[state.ledger.length - 1].id;

/** The feed with one entry changed; callers commit it together with any ledger change, so listeners never see half of a change. */
function withEntry(id, changes) {
  return S.feed.map((e) => (e.id === id ? { ...e, ...changes } : e));
}

/**
 * The assistant (or the scripted stand-in) has chosen items. Build the order
 * from the catalogue, run the checks, and act on the outcome for this rung.
 * @param {{request: string, output: object, source: string, scenario?: object}} input
 */
export function proposeOrder({ request, output, source, scenario = null }) {
  // Nothing can be checked, or paid, before the person has set rules. Not added to the feed: there is nothing to decide on.
  if (!S.mandate) return { id: null, status: 'no_rules', request, source, errors: [], proposal: null, decision: null };
  const id = `D${S.nextFeedId}`;
  const built = buildProposal(CATALOGUE, output);
  const rawItems = output && Array.isArray(output.items) ? output.items.slice(0, 25) : null;
  const entry = {
    id,
    at: S.clockMs,
    request,
    source,
    scenarioId: scenario ? scenario.id : null,
    note: output && typeof output.note === 'string' ? output.note.slice(0, 200) : null,
    rawItems,
    steered: scenario && scenario.steerTargets ? isSteered(scenario.steerTargets, rawItems) : null,
    errors: built.errors.map((e) => e.code),
    proposal: built.proposal,
    decision: null,
    approved: false,
    orderId: null,
    status: 'not_built',
    notes: [],
  };
  let ledgerState = S.ledgerState;
  if (built.ok) {
    const decision = evaluate({ mandate: S.mandate, compiled: compiled(), state: S.ledgerState, proposal: built.proposal, now: S.clockMs, catalogue: CATALOGUE, rung: S.rung });
    entry.decision = decision;
    entry.status = decision.outcome;
    if (decision.outcome === 'executed') {
      ledgerState = recordOrder(S.ledgerState, { merchantId: built.proposal.merchantId, amount: built.proposal.amount, ts: S.clockMs }, CATALOGUE);
      entry.orderId = lastOrderId(ledgerState);
      entry.status = 'paid';
    }
  }
  commit({ feed: [entry, ...S.feed], nextFeedId: S.nextFeedId + 1, ledgerState });
  return entry;
}

export function approve(entryId) {
  const e = S.feed.find((x) => x.id === entryId);
  if (!e || !['awaiting_approval', 'suggested'].includes(e.status)) return { ok: false, reason: 'NOT_WAITING' };
  const r = approveOrder({ mandate: S.mandate, compiled: compiled(), state: S.ledgerState, proposal: e.proposal, now: S.clockMs, catalogue: CATALOGUE });
  if (!r.executed) {
    // The checks run again at approval time. The clock, the ledger or the pause switch may have changed since the order was proposed.
    commit({ feed: withEntry(entryId, { decision: r.decision, status: 'blocked_on_approval', notes: [...e.notes, 'The checks ran again when you approved, and now stop this order.'] }) });
    return { ok: false, reason: 'BLOCKED_ON_APPROVAL', decision: r.decision };
  }
  commit({ ledgerState: r.state, feed: withEntry(entryId, { decision: r.decision, status: 'paid', approved: true, orderId: lastOrderId(r.state) }) });
  return { ok: true };
}

export function decline(entryId) {
  const e = S.feed.find((x) => x.id === entryId);
  if (!e || !['awaiting_approval', 'suggested'].includes(e.status)) return { ok: false, reason: 'NOT_WAITING' };
  commit({ feed: withEntry(entryId, { status: e.status === 'suggested' ? 'dismissed' : 'declined' }) });
  return { ok: true };
}

export function undo(entryId) {
  const e = S.feed.find((x) => x.id === entryId);
  if (!e || !e.orderId || e.status !== 'paid') return { ok: false, reason: 'NOT_PAID' };
  const r = undoOrder(S.ledgerState, e.orderId, S.clockMs, CATALOGUE);
  if (!r.ok) return r;
  commit({ ledgerState: r.state, feed: withEntry(entryId, { status: 'refunded', undoneAt: S.clockMs }) });
  return { ok: true };
}

export function pause(paused) {
  commit({ ledgerState: setPaused(S.ledgerState, paused) });
}

// ---------------------------------------------------------------- evidence and the ladder

export const setEvidence = (patch) => commit({ evidence: { ...S.evidence, ...patch } });

/** Moves up one rung if, and only if, the evidence passes the gate. */
export function promote() {
  const { gate } = evidence();
  if (!gate.allowed) return gate;
  commit({ rung: gate.to, evidence: { ...S.evidence, consent: false } });
  return gate;
}

export function resetAll() {
  S = initial();
  persist();
  for (const fn of [...listeners]) fn(S);
}
