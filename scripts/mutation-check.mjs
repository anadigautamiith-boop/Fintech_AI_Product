#!/usr/bin/env node
// Mutation check: does the test set notice when the code is wrong?
//
// Each mutant is one small deliberate bug (a comparison off by one, a check
// removed, a constant changed). The script copies the project to a temporary
// folder, applies one bug, runs the tests there, and records whether any test
// failed ("killed") or all still passed ("survived"). A survivor means the
// tests cannot tell the bug from correct code. Some survivors are harmless
// (the bug changes nothing anyone can observe); those are marked as such with
// the reason, and the rest are reported as gaps in the tests.
//
//   node scripts/mutation-check.mjs            run everything, write eval/results/mutation-check.json
//   node scripts/mutation-check.mjs --list     list the mutants without running them
//
// The project folder itself is never changed.

import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = 'public/js/core';

/**
 * `equivalent`: the bug cannot change any behaviour a caller can see, so a
 * surviving mutant is expected. It still has to be argued, in `why`.
 */
export const MUTANTS = [
  // --- policy engine: boundaries (strict comparisons) ---
  { id: 'M01', file: 'policy.js', from: "amount > mandate.perOrderCap) hard.push('OVER_ORDER_CAP')", to: "amount >= mandate.perOrderCap) hard.push('OVER_ORDER_CAP')", note: 'per-order limit: an order exactly at the limit is blocked' },
  { id: 'M02', file: 'policy.js', from: 'period.spentBefore + amount > period.cap', to: 'period.spentBefore + amount >= period.cap', note: 'period limit: reaching the limit exactly is blocked' },
  { id: 'M03', file: 'policy.js', from: 'amount > block.limit - used', to: 'amount >= block.limit - used', note: 'rail block: using the last rupee is blocked' },
  { id: 'M04', file: 'policy.js', from: "amount > mandate.askAbove) soft.push('ASK_ABOVE_THRESHOLD')", to: "amount >= mandate.askAbove) soft.push('ASK_ABOVE_THRESHOLD')", note: 'ask-above: an order exactly at the amount asks' },
  { id: 'M05', file: 'policy.js', from: 'age(o) <= DUPLICATE_WINDOW_MS', to: 'age(o) < DUPLICATE_WINDOW_MS', note: 'duplicate window: exactly 30 minutes no longer counts' },
  { id: 'M06', file: 'policy.js', from: 'age(o) <= SPLIT_WINDOW_MS', to: 'age(o) < SPLIT_WINDOW_MS', note: 'split window: exactly 60 minutes no longer counts' },
  // --- policy engine: missing or wrong checks ---
  { id: 'M07', file: 'policy.js', from: "o.status === 'paid' && o.ts >= window.start && o.ts <= window.end", to: 'o.ts >= window.start && o.ts <= window.end', note: 'refunded orders still count toward the period spend' },
  { id: 'M08', file: 'policy.js', from: "if (state.paused) return decision('block', ['MANDATE_PAUSED'], null, rung);", to: '', note: 'the pause switch is ignored' },
  { id: 'M09', file: 'policy.js', from: 'now > dayEnd(mandate.validUntil)', to: 'now > dayStart(mandate.validUntil)', note: 'the last day of a mandate is treated as expired' },
  { id: 'M10', file: 'policy.js', from: 'merchant.verified !== true', to: 'merchant.verified === false', note: 'a shop is trusted unless it is explicitly marked unverified' },
  { id: 'M11', file: 'policy.js', from: "if (mandate.categories && !mandate.categories.includes(merchant.category)) hard.push('CATEGORY_NOT_ALLOWED');", to: '', note: 'the allowed-categories rule is skipped' },
  { id: 'M12', file: 'policy.js', from: 'if (!category.reversible && !mandate.autoApproveIrreversible)', to: 'if (!category.reversible && mandate.autoApproveIrreversible)', note: 'asking about irreversible purchases is inverted' },
  { id: 'M13', file: 'policy.js', from: 'if (!isPositiveSafeInt(amount)) return null;', to: 'if (!(amount > 0)) return null;', note: 'a proposal amount may be a string or a fraction' },
  { id: 'M14', file: 'policy.js', from: "bounded: { allow: 'executed', ask: 'awaiting_approval', block: 'blocked' }", to: "bounded: { allow: 'executed', ask: 'executed', block: 'blocked' }", note: 'at the top rung, "ask" cases execute without asking' },
  { id: 'M15', file: 'policy.js', from: "const row = has(ROUTING, rung) ? ROUTING[rung] : ROUTING.suggest;", to: "const row = has(ROUTING, rung) ? ROUTING[rung] : ROUTING.bounded;", note: 'an unknown rung is treated as the most permissive one' },
  { id: 'M16', file: 'policy.js', from: "if (block && amount > block.limit - used) hard.push('RAIL_BLOCK_EXHAUSTED');", to: '', note: 'the rail block balance is not checked' },
  // --- time ---
  { id: 'M17', file: 'time.js', from: 'export const IST_OFFSET_MS = 330 * 60 * 1000;', to: 'export const IST_OFFSET_MS = 300 * 60 * 1000;', note: 'India time is taken as UTC+5:00' },
  { id: 'M18', file: 'time.js', from: '(d.getUTCDay() + 6) % 7', to: '(d.getUTCDay() + 5) % 7', note: 'weekdays are off by one' },
  // --- rail compile ---
  { id: 'M19', file: 'rail.js', from: 'Math.min(BLOCK_LIMIT, potentialSpend ?? BLOCK_LIMIT)', to: 'Math.max(BLOCK_LIMIT, potentialSpend ?? BLOCK_LIMIT)', note: 'block size uses the larger of the two figures' },
  { id: 'M20', file: 'rail.js', from: 'merchants.slice(0, room)', to: 'merchants.slice(0, room + 1)', note: 'one more block than the bank allows' },
  { id: 'M21', file: 'rail.js', from: 'month: 30', to: 'month: 31', note: 'a month is 31 days when sizing the exposure' },
  { id: 'M22', file: 'rail.js', from: 'Math.ceil(potentialSpend / BLOCK_LIMIT) - 1', to: 'Math.floor(potentialSpend / BLOCK_LIMIT)', note: 'renewals counted with floor instead of ceil minus one' },
  // --- mandate validation ---
  { id: 'M23', file: 'mandate.js', from: 'rawDuration > MAX_DURATION_DAYS', to: 'rawDuration >= MAX_DURATION_DAYS', note: 'a 90-day mandate is clamped and warned about' },
  { id: 'M24', file: 'mandate.js', from: 'askAbove >= perOrderCap', to: 'askAbove > perOrderCap', note: 'ask-above equal to the cap no longer warns' },
  // --- state changes ---
  { id: 'M25', file: 'state.js', from: 'now - order.ts > category.undoWindowMin * MINUTE_MS', to: 'now - order.ts >= category.undoWindowMin * MINUTE_MS', note: 'undo at exactly the window is refused' },
  { id: 'M26', file: 'state.js', from: "if (!category || !category.reversible) return { ok: false, reason: 'NOT_REVERSIBLE' };", to: "if (!category) return { ok: false, reason: 'NOT_REVERSIBLE' };", note: 'irreversible purchases are not recognised as such' },
  { id: 'M27', file: 'state.js', from: "if (decision.verdict === 'block') return { executed: false, decision, state };", to: '', note: 'approving an order skips the re-check, so a blocked order executes' },
  // --- promotion gate ---
  { id: 'M28', file: 'ladder.js', from: '!(s.rate < threshold)', to: '!(s.rate <= threshold)', note: 'a segment at exactly 10% passes' },
  { id: 'M29', file: 'ladder.js', from: '!(overall.rate < threshold)', to: '!(overall.rate <= threshold)', note: 'an overall rate at exactly 10% passes' },
  { id: 'M30', file: 'ladder.js', from: 'weeks < step.minWeeks', to: 'weeks <= step.minWeeks', note: 'exactly the minimum number of weeks is refused' },
  { id: 'M31', file: 'ladder.js', from: 's.events < minEvents', to: 's.events <= minEvents', note: 'a segment with exactly 50 events counts as too small' },
  { id: 'M32', file: 'ladder.js', from: "if (step.needsConsent && !consent) failures.push({ code: 'NO_CONSENT' });", to: '', note: 'moving to the top rung needs no consent' },
  { id: 'M33', file: 'ladder.js', from: "else if (!(s.rate < threshold)) failures.push({ code: 'SEGMENT_OVER_THRESHOLD', segment: name });", to: '', note: 'the gate judges only the overall rate, not each segment (the MoneyGro mistake)' },
  // --- receipts and money ---
  { id: 'M34', file: 'receipt.js', from: "actions: figures.undo.reversible ? ['undo'] : [],", to: "actions: ['undo'],", note: 'an undo button on a purchase that cannot be undone' },
  { id: 'M35', file: 'money.js', from: '.replace(/\\B(?=(\\d{2})+(?!\\d))/g, \',\')', to: '.replace(/\\B(?=(\\d{3})+(?!\\d))/g, \',\')', note: 'amounts grouped in thousands instead of the Indian lakh style' },
  // --- shadow-mode data ---
  { id: 'M36', file: 'shadow.js', from: 'family: 0.26', to: 'family: 0.06', note: 'the hidden-gap data set has no gap' },
  // --- model-output guards ---
  { id: 'M37', file: 'catalogue.js', from: "typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key)", to: "typeof key === 'string' && key in obj", note: 'lookups follow the prototype chain, so "constructor" resolves to a function' },
  { id: 'M38', file: 'proposal.js', from: 'wanted.set(sku, (wanted.get(sku) ?? 0) + qty)', to: 'wanted.set(sku, qty)', note: 'repeated lines for one item overwrite each other instead of adding up' },
  { id: 'M39', file: 'proposal.js', from: 'if (merchants.size > 1) {', to: 'if (merchants.size > 2) {', note: 'an order spanning two shops is accepted' },
  { id: 'M40', file: 'proposal.js', from: 'for (const [sku, qty] of wanted) if (qty > MAX_QTY) badQty.push(sku);', to: '', note: 'merged repeated lines can exceed the quantity limit' },
  { id: 'M41', file: 'coerce.js', from: "if (id === null) unresolved.push({ field, value: String(entry) });", to: 'if (id === null) { /* silently dropped */ }', note: 'a shop name that cannot be matched is dropped without a word (could widen a mandate)' },
  { id: 'M42', file: 'coerce.js', from: 'if (flag === true) fields.autoApproveIrreversible = true;', to: 'if (flag) fields.autoApproveIrreversible = true;', note: 'any truthy value, such as the text "false", switches on auto-approval of irreversible purchases' },
  { id: 'M43', file: 'coerce.js', from: "weekend: ['sat', 'sun']", to: "weekend: ['sun']", note: '"weekend" means only Sunday' },
  // --- bugs that should not matter ---
  {
    id: 'E01', file: 'coerce.js', from: 'const read = (key) => (has(modelOutput, key) ? modelOutput[key] : undefined);', to: 'const read = (key) => modelOutput[key];',
    note: 'reads model output keys without the own-property check',
    equivalent: true,
    why: 'The only keys read (merchants, categories, perOrderCap, ...) are not names found on Object.prototype, so no input can tell the two apart.',
  },
  {
    id: 'E02', file: 'proposal.js', from: 'qty < 1 || qty > MAX_QTY', to: 'qty < 1 || qty > MAX_QTY + 1',
    note: 'a single line with a quantity of exactly 100 passes the per-line check',
    equivalent: true,
    why: 'The same limit is checked a second time after repeated lines are merged, which rejects 100 with the same error code. Only the list of offending SKUs inside the error can differ.',
  },
];

function copyProject(to) {
  for (const entry of ['public', 'tests', 'package.json']) cpSync(join(ROOT, entry), join(to, entry), { recursive: true });
}

function runTests(dir) {
  const started = Date.now();
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/*.test.js'], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const failed = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
  const pass = Number(/^# pass (\d+)/m.exec(out)?.[1] ?? NaN);
  const fail = Number(/^# fail (\d+)/m.exec(out)?.[1] ?? NaN);
  return { status: run.status, timedOut: run.error?.code === 'ETIMEDOUT', failed, pass, fail, ms: Date.now() - started };
}

function main() {
  if (process.argv.includes('--list')) {
    for (const m of MUTANTS) console.log(`${m.id}  ${m.file.padEnd(14)} ${m.note}`);
    return;
  }
  const work = mkdtempSync(join(tmpdir(), 'reins-mutants-'));
  const results = [];
  try {
    copyProject(work);
    const base = runTests(work);
    if (base.status !== 0 || !(base.fail === 0)) {
      console.error(`The unmodified code does not pass its own tests (pass ${base.pass}, fail ${base.fail}). Fix that first.`);
      process.exit(2);
    }
    console.log(`Baseline: ${base.pass} tests pass.\n`);

    for (const m of MUTANTS) {
      const path = join(work, CORE, m.file);
      const original = readFileSync(join(ROOT, CORE, m.file), 'utf8');
      const count = original.split(m.from).length - 1;
      if (count !== 1) {
        results.push({ ...m, outcome: 'invalid', detail: `the text to change was found ${count} times, expected once` });
        console.log(`${m.id}  INVALID   ${m.note}  (found ${count}x)`);
        continue;
      }
      writeFileSync(path, original.replace(m.from, () => m.to));
      const r = runTests(work);
      writeFileSync(path, original);
      const killed = r.status !== 0 || r.timedOut;
      const outcome = killed ? 'killed' : 'survived';
      results.push({ ...m, outcome, failedTests: r.failed.length, firstFailing: r.failed.slice(0, 3), timedOut: r.timedOut });
      const tag = outcome === 'killed' ? 'killed  ' : m.equivalent ? 'survived*' : 'SURVIVED';
      console.log(`${m.id}  ${tag}  ${m.note}${killed ? `  [${r.failed.length} failing, e.g. ${r.failed[0] ?? 'crash'}]` : ''}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const real = results.filter((r) => !r.equivalent);
  const killed = real.filter((r) => r.outcome === 'killed').length;
  const survivors = real.filter((r) => r.outcome === 'survived');
  const invalid = results.filter((r) => r.outcome === 'invalid');
  const equivalent = results.filter((r) => r.equivalent);
  const summary = {
    generatedBy: 'scripts/mutation-check.mjs',
    mutants: real.length,
    killed,
    survived: survivors.length,
    invalid: invalid.length,
    score: real.length ? killed / real.length : null,
    survivors: survivors.map((s) => ({ id: s.id, file: s.file, note: s.note })),
    expectedToSurvive: equivalent.map((e) => ({ id: e.id, file: e.file, note: e.note, outcome: e.outcome, why: e.why })),
  };
  const dir = join(ROOT, 'eval/results');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mutation-check.json'), `${JSON.stringify({ summary, results: results.map(({ from, to, ...rest }) => rest) }, null, 2)}\n`);

  console.log(`\n${killed} of ${real.length} bugs caught (${Math.round(summary.score * 100)}%).`);
  if (survivors.length) console.log(`Not caught: ${survivors.map((s) => s.id).join(', ')}`);
  if (invalid.length) console.log(`Invalid mutants (script out of date): ${invalid.map((s) => s.id).join(', ')}`);
  for (const e of equivalent) console.log(`${e.id} (expected to survive): ${e.outcome}`);
  if (invalid.length) process.exit(3);
}

main();
