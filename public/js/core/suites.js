// Runs the labelled test cases in public/data/tests/ against the engine.
//
// The same code runs in Node (`npm test`) and in the browser (the Tests page),
// so a case that passes in one passes in the other. A runner never throws for a
// failing case: it returns a result with `expected` and `actual` that differ.
// The model-run suites (parse, agent) use runModelSuite at the end of this file,
// which needs a live Worker; their scoring is in model-eval.js.

import { CATALOGUE } from './catalogue-data.js';
import { scoreAgent, scoreParse, summarizeAgent, summarizeParse } from './model-eval.js';

// Engine modules are loaded lazily and one by one, so a module that is missing
// or broken fails only the suites that need it, with a message saying which.
const LOADERS = {
  time: () => import('./time.js'),
  mandate: () => import('./mandate.js'),
  rail: () => import('./rail.js'),
  policy: () => import('./policy.js'),
  state: () => import('./state.js'),
  receipt: () => import('./receipt.js'),
  ladder: () => import('./ladder.js'),
  shadow: () => import('./shadow.js'),
  proposal: () => import('./proposal.js'),
  coerce: () => import('./coerce.js'),
};

let engine = null;

async function loadEngine() {
  if (engine) return engine;
  const entries = await Promise.all(
    Object.entries(LOADERS).map(async ([name, load]) => {
      try {
        return [name, await load()];
      } catch (err) {
        return [name, { __unavailable: String(err && err.message ? err.message : err) }];
      }
    }),
  );
  engine = Object.fromEntries(entries);
  return engine;
}

function need(moduleName, fn) {
  const m = engine && engine[moduleName];
  const f = m && m[fn];
  if (typeof f !== 'function') {
    throw new Error(`${moduleName}.js: ${fn}() is not available${m && m.__unavailable ? ` (${m.__unavailable})` : ''}`);
  }
  return f;
}

const parseInstant = (...a) => need('time', 'parseInstant')(...a);
const normalizeMandate = (...a) => need('mandate', 'normalizeMandate')(...a);
const compileMandate = (...a) => need('rail', 'compileMandate')(...a);
const evaluate = (...a) => need('policy', 'evaluate')(...a);
const newState = (...a) => need('state', 'newState')(...a);
const recordOrder = (...a) => need('state', 'recordOrder')(...a);
const undoOrder = (...a) => need('state', 'undoOrder')(...a);
const approveOrder = (...a) => need('state', 'approveOrder')(...a);
const setPaused = (...a) => need('state', 'setPaused')(...a);
const buildReceipt = (...a) => need('receipt', 'buildReceipt')(...a);
const checkPromotion = (...a) => need('ladder', 'checkPromotion')(...a);
const generateShadowEvents = (...a) => need('shadow', 'generateShadowEvents')(...a);
const summarizeEvents = (...a) => need('shadow', 'summarizeEvents')(...a);
const buildProposal = (...a) => need('proposal', 'buildProposal')(...a);
const coerceParsed = (...a) => need('coerce', 'coerceParsed')(...a);

// ---------------------------------------------------------------- registry

export const SUITES = [
  { id: 'policy', file: 'policy', title: 'Policy engine', blurb: 'Verdict, outcome and reasons for each order, including boundaries, IST time, windows, rungs, undo and approval.' },
  { id: 'injection', file: 'injection', title: 'Hostile and spoofed proposals', blurb: 'Fields the engine must ignore, look-alike ids, and sequences built to slip under a limit.' },
  { id: 'known-gaps', file: 'known-gaps', title: 'Known gaps', blurb: 'What v1 does not catch, asserted at current behaviour so a change forces the spec to be updated.' },
  { id: 'normalize', file: 'normalize', title: 'Mandate validation', blurb: 'Errors, warnings and cleaning of a raw mandate.' },
  { id: 'compile', file: 'compile', title: 'Rail blocks', blurb: 'How a mandate maps onto per-merchant rail blocks, and who enforces each rule.' },
  { id: 'receipts', file: 'receipts', title: 'Receipts', blurb: 'Exact receipt text, plus a check that every rupee amount in every receipt comes from the decision.' },
  { id: 'shadow', file: 'shadow', title: 'Shadow mode and promotion gate', blurb: 'When the agent may move up the autonomy ladder, including the case where the overall rate hides a weak segment.' },
  { id: 'proposal', file: 'proposal', title: 'Agent output to proposal', blurb: 'The merchant and amount come from the catalogue, never from the model.' },
  { id: 'coerce', file: 'coerce', title: 'Mandate-reader output to form', blurb: 'Untrusted model output is mapped to ids; what cannot be mapped is reported, not guessed.' },
  { id: 'steered', file: 'agent-scenarios', title: 'If the agent is fooled', blurb: 'The order a fully steered agent would send for each hostile listing, checked against the engine.' },
];

export const MODEL_SUITES = [
  { id: 'parse', file: 'parse-gold', title: 'Mandate reader (model)', blurb: 'Thirty labelled instructions run through the live reader.' },
  { id: 'agent', file: 'agent-scenarios', title: 'Shopping agent (model)', blurb: 'Ten requests, seven with hostile or misleading listings, run through the live agent.' },
];

export function suiteFiles() {
  return ['shared', ...new Set([...SUITES, ...MODEL_SUITES].map((s) => s.file))];
}

/** @param {string} id @param {{[file: string]: any}} files parsed JSON by file stem */
export async function runSuite(id, files) {
  await loadEngine();
  const meta = SUITES.find((s) => s.id === id);
  if (!meta) throw new Error(`unknown suite ${id}`);
  const data = files[meta.file];
  const shared = files.shared;
  let results;
  switch (id) {
    case 'policy': results = runOrderCases(data, shared); break;
    case 'injection': results = runOrderCases(data, shared); break;
    case 'known-gaps': results = runOrderCases(data, shared).map(markKnownGap); break;
    case 'normalize': results = data.cases.map((c) => guard(c, () => runNormalize(c, shared))); break;
    case 'compile': results = data.cases.map((c) => guard(c, () => runCompile(c, shared))); break;
    case 'receipts': results = runReceipts(data, files.policy, shared); break;
    case 'shadow': results = data.cases.map((c) => guard(c, () => runShadow(c, data))); break;
    case 'proposal': results = data.cases.map((c) => guard(c, () => runProposal(c))); break;
    case 'coerce': results = data.cases.map((c) => guard(c, () => runCoerce(c))); break;
    case 'steered': results = data.scenarios.map((s) => guard(s, () => runSteered(s, data.defaults, shared))); break;
    default: throw new Error(`no runner for ${id}`);
  }
  const counts = { total: results.length, pass: 0, fail: 0, knownGap: 0 };
  for (const r of results) {
    if (r.status === 'known-gap') counts.knownGap += 1;
    else if (r.pass) counts.pass += 1;
    else counts.fail += 1;
  }
  return { id, title: meta.title, blurb: meta.blurb, results, counts };
}

// ---------------------------------------------------------------- helpers

export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/** Keep only the keys the expectation mentions, so expectations can be partial. */
export function project(actual, expected) {
  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) return actual;
  if (actual === null || typeof actual !== 'object') return actual;
  const out = {};
  for (const key of Object.keys(expected)) out[key] = project(actual[key], expected[key]);
  return out;
}

function result(c, expected, actual, extra = {}) {
  const pass = deepEqual(expected, actual);
  return { id: c.id, group: c.group ?? null, title: c.title ?? '', pass, status: pass ? 'pass' : 'fail', expected, actual, ...extra };
}

function guard(c, fn) {
  try {
    return fn();
  } catch (err) {
    return { id: c.id, group: c.group ?? null, title: c.title ?? '', pass: false, status: 'fail', expected: 'the case to run', actual: { error: String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err) } };
  }
}

function markKnownGap(r) {
  return { ...r, status: r.pass ? 'known-gap' : 'fail' };
}

const sorted = (list) => [...list].sort();
const round4 = (n) => Math.round(n * 10000) / 10000;

function rawMandate(c, shared) {
  if (c.mandateRaw) return structuredClone(c.mandateRaw);
  if (c.raw) return structuredClone(c.raw);
  const spec = c.from ?? { base: c.mandate };
  const raw = { ...structuredClone(shared.mandates[spec.base]), ...structuredClone(spec.set ?? {}) };
  for (const key of spec.unset ?? []) delete raw[key];
  return raw;
}

function bankFor(bank, shared) {
  return typeof bank === 'string' ? shared.banks[bank] : bank;
}

// ---------------------------------------------------------------- policy-style cases

function orderContext(c, defaults, shared) {
  const spec = { ...c, mandate: c.mandate ?? defaults.mandate };
  const raw = rawMandate(c.mandateRaw ? c : spec, shared);
  const norm = normalizeMandate(raw, { today: shared.today, catalogue: CATALOGUE });
  if (!norm.ok) throw new Error(`fixture mandate does not normalise: ${JSON.stringify(norm.errors)}`);
  const compiled = compileMandate(norm.mandate, bankFor(c.bank ?? defaults.bank, shared));
  return { mandate: norm.mandate, compiled, rung: c.rung ?? defaults.rung, now: c.now ?? defaults.now };
}

function stateFromCase(c) {
  const ledger = (c.ledger ?? []).map((e, i) => ({
    id: `L${i + 1}`,
    merchantId: e.merchantId,
    category: CATALOGUE.merchants[e.merchantId]?.category ?? null,
    amount: e.amount,
    ts: parseInstant(e.ts),
    status: e.status ?? 'paid',
  }));
  const railUsed = {};
  for (const e of ledger) railUsed[e.merchantId] = (railUsed[e.merchantId] ?? 0) + e.amount; // gross: refunds do not reduce it
  Object.assign(railUsed, c.railUsed ?? {});
  return { paused: Boolean(c.paused), ledger, railUsed };
}

/** Evaluate one single-order case. Shared with the receipts suite. */
export function decideCase(c, defaults, shared) {
  const ctx = orderContext(c, defaults, shared);
  const decision = evaluate({
    mandate: ctx.mandate,
    compiled: ctx.compiled,
    state: stateFromCase(c),
    proposal: c.proposal,
    now: parseInstant(ctx.now),
    catalogue: CATALOGUE,
    rung: ctx.rung,
  });
  return { decision, ...ctx };
}

function runOrderCases(data, shared) {
  return data.cases.map((c) => guard(c, () => (c.steps ? runSequence(c, data.defaults, shared) : runSingle(c, data.defaults, shared))));
}

function runSingle(c, defaults, shared) {
  const { decision } = decideCase(c, defaults, shared);
  const expected = c.expect;
  const actual = project(decision, expected);
  return result(c, expected, actual, { ideal: c.ideal, why: c.why, scenario: c.scenario });
}

function runSequence(c, defaults, shared) {
  const ctx = orderContext(c, defaults, shared);
  let state = newState();
  const labels = {};
  const expected = [];
  const actual = [];
  c.steps.forEach((step, index) => {
    const now = parseInstant(step.at);
    let got;
    if (step.pause !== undefined) {
      state = setPaused(state, step.pause);
      return;
    }
    if (step.undo !== undefined || step.undoOrderId !== undefined) {
      const orderId = step.undoOrderId ?? labels[step.undo]?.orderId;
      const r = undoOrder(state, orderId, now, CATALOGUE);
      if (r.ok) state = r.state;
      got = project({ ok: r.ok, reason: r.reason }, step.expect);
    } else if (step.approve !== undefined) {
      const ref = labels[step.approve];
      const r = approveOrder({ mandate: ctx.mandate, compiled: ctx.compiled, state, proposal: ref.proposal, now, catalogue: CATALOGUE });
      if (r.executed) {
        state = r.state;
        ref.orderId = state.ledger[state.ledger.length - 1].id;
      }
      got = project({ executed: r.executed, verdict: r.decision.verdict, reasons: r.decision.reasons }, step.expect);
    } else {
      const decision = evaluate({ mandate: ctx.mandate, compiled: ctx.compiled, state, proposal: step.proposal, now, catalogue: CATALOGUE, rung: ctx.rung });
      let orderId = null;
      if (decision.outcome === 'executed') {
        state = recordOrder(state, { merchantId: step.proposal.merchantId, amount: step.proposal.amount, ts: now }, CATALOGUE);
        orderId = state.ledger[state.ledger.length - 1].id;
      }
      if (step.label) labels[step.label] = { proposal: step.proposal, orderId };
      got = project(decision, step.expect);
    }
    const want = { step: index + 1, ...step.expect };
    const have = { step: index + 1, ...got };
    if (step.expectState) {
      want.state = step.expectState;
      have.state = { railUsed: state.railUsed }; // compared exactly, not projected
    }
    expected.push(want);
    actual.push(have);
  });
  return result(c, expected, actual, { ideal: c.ideal, why: c.why, scenario: c.scenario });
}

// ---------------------------------------------------------------- normalize, compile

function runNormalize(c, shared) {
  const r = normalizeMandate(rawMandate(c, shared), { today: c.today ?? shared.today, catalogue: CATALOGUE });
  const expected = { ok: c.expect.ok, errors: sorted(c.expect.errors), warnings: sorted(c.expect.warnings) };
  const actual = { ok: r.ok, errors: sorted(r.errors.map((e) => `${e.code}@${e.field}`)), warnings: sorted(r.warnings.map((w) => w.code)) };
  if ('mandate' in c.expect) {
    expected.mandate = c.expect.mandate;
    actual.mandate = project(r.mandate, c.expect.mandate);
  }
  if (c.expect.mandateKeys) {
    expected.mandateKeys = sorted(c.expect.mandateKeys);
    actual.mandateKeys = r.mandate ? sorted(Object.keys(r.mandate)) : null;
  }
  return result(c, expected, actual);
}

function runCompile(c, shared) {
  const norm = normalizeMandate(rawMandate(c, shared), { today: shared.today, catalogue: CATALOGUE });
  if (!norm.ok) throw new Error(`fixture mandate does not normalise: ${JSON.stringify(norm.errors)}`);
  const compiled = compileMandate(norm.mandate, bankFor(c.bank, shared));
  const full = {
    days: compiled.days,
    potentialSpend: compiled.potentialSpend,
    blockSize: compiled.blockSize,
    backed: compiled.blocks.map((b) => b.merchantId),
    unbacked: compiled.unbacked,
    renewalsNeeded: compiled.renewalsNeeded,
    warnings: sorted(compiled.warnings.map((w) => w.code)),
    rules: sorted(compiled.rules.map((r) => `${r.field}:${r.enforcedBy}`)),
  };
  const expected = { ...c.expect, warnings: sorted(c.expect.warnings) };
  if (c.expect.rules) expected.rules = sorted(c.expect.rules);
  return result(c, expected, project(full, expected));
}

// ---------------------------------------------------------------- receipts

const RUPEE_FIELDS = [
  ['amount'], ['perOrderCap'], ['askAbove'],
  ['period', 'cap'], ['period', 'spentBefore'], ['period', 'remainingBefore'], ['period', 'remainingAfter'],
  ['rail', 'limit'], ['rail', 'used'], ['rail', 'remainingBefore'], ['rail', 'remainingAfter'],
];

function receiptText(receipt) {
  return [receipt.headline, ...receipt.lines].join('\n');
}

function rupeeAmounts(text) {
  return [...text.matchAll(/₹([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
}

function allowedRupees(figures) {
  const out = new Set();
  if (!figures) return out;
  for (const path of RUPEE_FIELDS) {
    let v = figures;
    for (const key of path) v = v == null ? v : v[key];
    if (Number.isInteger(v)) out.add(v);
  }
  return out;
}

function runReceipts(data, policy, shared) {
  const byId = Object.fromEntries(policy.cases.filter((p) => !p.steps).map((p) => [p.id, p]));
  const out = data.cases.map((c) =>
    guard(c, () => {
      const source = byId[c.from];
      if (!source) throw new Error(`receipt case ${c.id} refers to unknown policy case ${c.from}`);
      const { decision } = decideCase(source, policy.defaults, shared);
      const receipt = buildReceipt(decision, { approved: Boolean(c.approved) });
      const text = receiptText(receipt);
      const e = c.expect;
      const expected = { headline: e.headline };
      const actual = { headline: receipt.headline };
      if (e.tone) { expected.tone = e.tone; actual.tone = receipt.tone; }
      if (e.actions) { expected.actions = e.actions; actual.actions = receipt.actions; }
      expected.missingText = [];
      actual.missingText = (e.includes ?? []).filter((s) => !text.includes(s));
      expected.unwantedText = [];
      actual.unwantedText = (e.excludes ?? []).filter((s) => text.includes(s));
      if (e.noRupee) { expected.rupeeAmounts = []; actual.rupeeAmounts = rupeeAmounts(text); }
      return result(c, expected, actual);
    }),
  );
  out.push(guard({ id: 'RP', title: `Every rupee amount in every receipt comes from the decision (${Object.keys(byId).length} policy cases)` }, () => {
    const violations = [];
    for (const source of Object.values(byId)) {
      const { decision } = decideCase(source, policy.defaults, shared);
      const receipt = buildReceipt(decision, {});
      const text = receiptText(receipt);
      const allowed = allowedRupees(decision.figures);
      const stray = rupeeAmounts(text).filter((n) => !allowed.has(n));
      if (stray.length) violations.push(`${source.id}: ₹${stray.join(', ₹')} not in figures`);
      if (!decision.figures && text.includes('₹')) violations.push(`${source.id}: rupee sign in a receipt with no figures`);
      if (typeof receipt.headline !== 'string' || !receipt.headline) violations.push(`${source.id}: empty headline`);
      if (!Array.isArray(receipt.lines) || receipt.lines.some((l) => typeof l !== 'string')) violations.push(`${source.id}: lines are not all text`);
      if (/undefined|NaN|\bnull\b|\[object/.test(text)) violations.push(`${source.id}: placeholder text leaked into the receipt`);
    }
    return result({ id: 'RP', group: 'property', title: `Every rupee amount in every receipt comes from the decision (${Object.keys(byId).length} policy cases)` }, { violations: [] }, { violations });
  }));
  return out;
}

// ---------------------------------------------------------------- shadow

function gateActual(r) {
  return {
    allowed: r.allowed,
    to: r.to,
    failures: sorted(r.failures.map((f) => (f.segment ? `${f.code}@${f.segment}` : f.code))),
  };
}

function runShadow(c, data) {
  if (c.type === 'gate') {
    const r = checkPromotion({ ...c.input, threshold: data.threshold, minEvents: data.minEvents });
    const full = { ...gateActual(r), overall: { events: r.overall.events, overrides: r.overall.overrides, rate: round4(r.overall.rate) } };
    const expected = { ...c.expect, failures: sorted(c.expect.failures) };
    return result(c, expected, project(full, expected));
  }
  if (c.type === 'determinism') {
    const g = c.generate;
    const first = generateShadowEvents(g);
    const again = generateShadowEvents(g);
    const other = generateShadowEvents({ ...g, seed: c.otherSeed });
    const expected = { count: g.weeks * g.eventsPerWeek, sameSeedIdentical: true, otherSeedDiffers: true };
    const actual = { count: first.length, sameSeedIdentical: deepEqual(first, again), otherSeedDiffers: !deepEqual(first, other) };
    return result(c, expected, actual);
  }
  if (c.type === 'generated') {
    const events = generateShadowEvents(c.generate);
    const summary = summarizeEvents(events);
    const between = (v, [lo, hi]) => v >= lo && v <= hi;
    const rateOf = (s) => (s.events ? s.overrides / s.events : null);
    const gate = checkPromotion({ from: c.gate.from, weeks: summary.weeks, consent: c.gate.consent, segments: summary.segments, threshold: data.threshold, minEvents: data.minEvents });
    const e = c.expect;
    const expected = { events: e.events, weeks: e.weeks, overallInRange: true, segmentInRange: Object.fromEntries(Object.keys(e.segmentBetween).map((k) => [k, true])), ...{ allowed: e.allowed, failures: sorted(e.failures) } };
    const actual = {
      events: events.length,
      weeks: summary.weeks,
      overallInRange: between(summary.overall.rate, e.overallBetween),
      segmentInRange: Object.fromEntries(Object.entries(e.segmentBetween).map(([k, range]) => [k, summary.segments[k] ? between(rateOf(summary.segments[k]), range) : false])),
      allowed: gate.allowed,
      failures: gateActual(gate).failures,
    };
    if ('to' in e) { expected.to = e.to; actual.to = gate.to; }
    return result(c, expected, actual, { detail: `overall ${round4(summary.overall.rate)}; ${Object.entries(summary.segments).map(([k, s]) => `${k} ${round4(rateOf(s))}`).join('; ')}` });
  }
  throw new Error(`unknown shadow case type ${c.type}`);
}

// ---------------------------------------------------------------- proposal, coerce, steered

function runProposal(c) {
  const r = buildProposal(CATALOGUE, c.agentOutput);
  const e = c.expect;
  const expected = { ok: e.ok, errors: sorted(e.errors) };
  const actual = { ok: r.ok, errors: sorted(r.errors.map((x) => x.code)) };
  if ('merchantId' in e) { expected.merchantId = e.merchantId; actual.merchantId = r.proposal?.merchantId; }
  if ('amount' in e) { expected.amount = e.amount; actual.amount = r.proposal?.amount; }
  if (e.items) { expected.items = e.items; actual.items = r.proposal?.items.map((i) => ({ sku: i.sku, qty: i.qty })); }
  return result(c, expected, actual);
}

function runCoerce(c) {
  const r = coerceParsed(c.model, CATALOGUE);
  const e = c.expect;
  const expected = { fields: e.fields };
  const actual = { fields: project(r.fields, e.fields) };
  if (e.unresolved) {
    expected.unresolved = sorted(e.unresolved);
    actual.unresolved = sorted(r.unresolved.map((u) => `${u.field}:${u.value}`));
  }
  if (e.notes) { expected.notes = e.notes; actual.notes = r.notes; }
  return result(c, expected, actual);
}

function runSteered(s, defaults, shared) {
  const order = s.ifSteered ? s.ifSteered.items : s.ideal;
  const want = s.ifSteered ? s.ifSteered.expect : s.expectEngine;
  const built = buildProposal(CATALOGUE, { items: order });
  const expected = { built: want.built };
  const actual = { built: built.ok };
  if (want.built === false) {
    expected.buildErrors = sorted(want.buildErrors);
    actual.buildErrors = sorted(built.errors.map((x) => x.code));
  } else {
    expected.verdict = want.verdict;
    expected.reasons = want.reasons;
    if (built.ok) {
      const { mandate, compiled, rung, now } = orderContext(s, defaults, shared);
      const decision = evaluate({ mandate, compiled, state: newState(), proposal: built.proposal, now: parseInstant(now), catalogue: CATALOGUE, rung });
      actual.verdict = decision.verdict;
      actual.reasons = decision.reasons;
    }
  }
  return result({ id: s.id, group: s.kind, title: s.title }, expected, actual);
}

// ---------------------------------------------------------------- model suites

/**
 * Runs a model suite against the live Worker. `callApi(path, body)` returns the
 * Worker's JSON answer, or `{ok: false, error}`, and must not throw. Cases run
 * one after another so the free daily allowance is used slowly and the page
 * can show progress. An error from the Worker counts as a failed case and is
 * reported as an error, never skipped.
 *
 * @param {'parse'|'agent'} id
 * @param {{[file: string]: any}} files parsed JSON by file stem
 * @param {(path: string, body: object) => Promise<object>} callApi
 * @param {{guard?: boolean, onResult?: Function, shouldStop?: () => boolean}} [options]
 */
export async function runModelSuite(id, files, callApi, { guard = true, onResult, shouldStop } = {}) {
  await loadEngine();
  const meta = MODEL_SUITES.find((s) => s.id === id);
  if (!meta) throw new Error(`unknown model suite ${id}`);
  const data = files[meta.file];
  const shared = files.shared;
  const list = id === 'parse' ? data.cases : data.scenarios;
  const results = [];
  for (const c of list) {
    if (shouldStop && shouldStop()) break;
    let r;
    try {
      r = id === 'parse' ? await runParseCase(c, data, callApi) : await runAgentCase(c, data, shared, callApi, guard);
    } catch (err) {
      r = { id: c.id, group: 'error', title: c.title ?? c.text ?? c.id, status: 'error', pass: false, message: String(err && err.message ? err.message : err) };
    }
    results.push(r);
    if (onResult) onResult(r, results.length, list.length);
  }
  const counts = { total: results.length, pass: 0, fail: 0, error: 0 };
  for (const r of results) {
    if (r.status === 'error') counts.error += 1;
    else if (r.pass) counts.pass += 1;
    else counts.fail += 1;
  }
  const summary = id === 'parse' ? summarizeParse(results) : summarizeAgent(results);
  return { id, title: meta.title, blurb: meta.blurb, results, counts, summary, guard: id === 'agent' ? guard : undefined, complete: results.length === list.length };
}

async function runParseCase(gold, data, callApi) {
  const api = await callApi('/api/parse-mandate', { text: gold.text });
  return scoreParse(gold, data.defaults, api);
}

async function runAgentCase(s, data, shared, callApi, guard) {
  const api = await callApi('/api/agent', { request: s.request, skus: s.skus, listingOverrides: s.listingOverrides ?? {}, guard });
  if (!api || api.ok !== true) return scoreAgent(s, { api, built: null, decision: null });
  // The order is rebuilt and judged here from the model's raw output, not taken from the Worker's copy.
  const built = buildProposal(CATALOGUE, api.output);
  let decision = null;
  if (built.ok) {
    const { mandate, compiled, rung, now } = orderContext(s, data.defaults, shared);
    decision = evaluate({ mandate, compiled, state: newState(), proposal: built.proposal, now: parseInstant(now), catalogue: CATALOGUE, rung });
  }
  return scoreAgent(s, { api, built, decision });
}
