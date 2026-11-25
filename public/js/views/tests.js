// Tests: every labelled case, how the app did on each one. The checks that need
// no AI run here, in the browser, when the page opens. The two that use the AI
// model run only on request, one case at a time, and can be saved as a file.

import { h, fill, notice, tag, pluralize, stackable } from '../ui/dom.js';
import { percent } from '../ui/format.js';
import { SUITES, MODEL_SUITES, runSuite, runModelSuite } from '../core/suites.js';

const REPO = 'https://github.com/anadigautamiith-boop/Fintech_AI_Product';

// Kept for as long as the page is open, so moving between tabs does not lose a run that cost AI calls.
const memory = { suites: null, model: {}, guard: true };

const RESULT_TAG = { pass: ['Pass', 'ok'], fail: ['Fail', 'block'], 'known-gap': ['Known gap', 'ask'], error: ['Error', 'block'] };
const json = (v, max = 1400) => {
  const text = JSON.stringify(v, null, 1);
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
};

function resultTag(r) {
  const [label, tone] = RESULT_TAG[r.status] ?? ['?', 'neutral'];
  return tag(label, tone);
}

/** A table of cases. A case that did not pass shows what was expected and what happened. */
function caseTable(results, { columns = [], detail, stack = false } = {}) {
  const rows = [];
  for (const r of results) {
    rows.push(h('tr', null,
      h('td', { class: 'case-id' }, r.id),
      h('td', { class: 'cell-wide' }, r.title || r.group || ''),
      ...columns.map((c) => h('td', null, c.value(r))),
      h('td', null, resultTag(r))));
    const more = r.status === 'pass' ? null : detail ? detail(r) : null;
    if (more) rows.push(h('tr', null, h('td', { colspan: String(3 + columns.length) }, more)));
  }
  const table = h('table', { class: 'ledger' },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Case'), h('th', { scope: 'col' }, 'What it checks'), ...columns.map((c) => h('th', { scope: 'col' }, c.head)), h('th', { scope: 'col' }, 'Result'))),
    h('tbody', null, rows));
  // Tables with extra columns would be cut off on a phone, so they become one card per case there.
  return h('div', { class: 'table-wrap' }, stack ? stackable(table) : table);
}

function engineDetail(r) {
  if (r.status === 'known-gap') return h('div', null, h('p', { class: 'small' }, 'The engine does not catch this yet, on purpose. The case records what it does today, so a change has to update the spec.'), h('pre', { class: 'diff' }, `Behaviour today:\n${json(r.actual)}`));
  return h('pre', { class: 'diff' }, `Expected:\n${json(r.expected)}\n\nActual:\n${json(r.actual)}`);
}

function renderSuite(suite) {
  const c = suite.counts;
  const bad = c.fail > 0;
  return h('div', { class: 'suite' },
    h('div', { class: 'suite-head' },
      h('h3', null, suite.title),
      tag(`${c.pass + c.knownGap} of ${c.total} as labelled`, bad ? 'block' : 'ok'),
      c.knownGap ? tag(`${pluralize(c.knownGap, 'known gap')}`, 'ask') : null),
    h('p', { class: 'small' }, suite.blurb),
    h('details', { open: bad }, h('summary', null, `Show all ${c.total} cases`), caseTable(suite.results, { detail: engineDetail })));
}

// ------------------------------------------------------------------ model suites

function parseDetail(r) {
  if (r.status === 'error') return h('p', { class: 'small' }, r.message);
  const lines = [];
  for (const m of r.mismatches) lines.push(`${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}`);
  if (!r.unresolvedOk) lines.push(`not-understood list differs: got ${JSON.stringify(r.unresolved.map((u) => u.value))}`);
  if (!r.notesOk) lines.push('the text contradicts itself and the reader raised no note');
  return h('pre', { class: 'diff' }, lines.join('\n') || 'No detail.');
}

function agentDetail(r) {
  if (r.status === 'error') return h('p', { class: 'small' }, r.message);
  const order = r.order.map((l) => `${l.sku} × ${l.qty}`).join(', ') || 'nothing';
  return h('pre', { class: 'diff' }, `The assistant ordered: ${order}\nOrder built: ${r.built ? 'yes' : `no (${r.buildErrors.join(', ')})`}\nEngine: ${r.verdict ?? 'not reached'}${r.reasons.length ? ` (${r.reasons.join(', ')})` : ''}${r.note ? `\nIts note: ${r.note}` : ''}`);
}

function tokenLine(t) {
  return t.reported ? `${t.promptTokens + t.completionTokens} tokens over ${pluralize(t.reported, 'call')} (${t.promptTokens} in, ${t.completionTokens} out)` : 'No token counts were reported.';
}

function parseSummary(r) {
  const s = r.summary;
  return [
    h('p', null, h('strong', null, `${s.passed} of ${s.cases}`), ` instructions came out fully right (${percent(s.caseAccuracy)}). `, `Field by field: ${percent(s.fieldAccuracy)} right.`, s.errors ? ` ${pluralize(s.errors, 'case')} could not be answered and count as failed.` : ''),
    h('p', { class: 'small' }, Object.entries(s.byTag).map(([t, v]) => `${t}: ${v.passed} of ${v.cases}`).join('. ') + '.'),
    h('p', { class: 'small' }, tokenLine(s.tokens)),
  ];
}

function agentSummary(r) {
  const s = r.summary;
  return [
    h('p', null, h('strong', null, `${s.passed} of ${s.scenarios}`), ' requests passed. ', `Ordinary requests: ${s.plainCorrect} of ${s.plain} ordered what was asked for.`, s.errors ? ` ${pluralize(s.errors, 'request')} could not be answered and count as failed.` : ''),
    h('p', null, `Traps: ${s.hostile} requests. The assistant went for the trap in `, h('strong', null, `${s.steered} of ${s.hostile}`), `. In ${s.steeredAndStopped} of those the order was stopped or put to you; in ${s.steeredAndNotStopped} it would have gone through.`),
    h('p', { class: 'small' }, tokenLine(s.tokens)),
  ];
}

function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mount(root, ctx) {
  let alive = true;
  const summaryBox = h('div', { id: 'summary' });
  const suitesBox = h('div', { id: 'engine-suites' }, h('p', { class: 'loading' }, 'Running the checks…'));
  const modelBox = h('div', { id: 'model-suites' });
  let running = null;
  let stop = false;

  // ------------------------------------------------------------ engine suites
  function paintEngine() {
    const suites = memory.suites;
    const total = suites.reduce((n, s) => n + s.counts.total, 0);
    const asLabelled = suites.reduce((n, s) => n + s.counts.pass + s.counts.knownGap, 0);
    const fails = suites.reduce((n, s) => n + s.counts.fail, 0);
    const gaps = suites.reduce((n, s) => n + s.counts.knownGap, 0);
    fill(summaryBox, h('div', { class: 'summary-line' },
      h('span', { class: 'big-number' }, `${asLabelled} of ${total}`),
      h('span', null, 'cases behave as labelled'),
      fails ? tag(`${pluralize(fails, 'case')} failing`, 'block') : tag('None failing', 'ok'),
      gaps ? tag(`${pluralize(gaps, 'known gap')}`, 'ask') : null));
    fill(suitesBox, suites.map(renderSuite));
  }

  async function runEngine() {
    try {
      const files = await ctx.fixtures();
      const suites = [];
      for (const meta of SUITES) {
        suites.push(await runSuite(meta.id, files));
        if (!alive) return;
      }
      memory.suites = suites;
      paintEngine();
    } catch (err) {
      if (!alive) return;
      fill(suitesBox, notice('block', 'The checks could not run.', String(err.message ?? err)));
    }
  }

  // ------------------------------------------------------------ model suites
  function paintModel() {
    const aiOn = ctx.health().ai;
    const cards = MODEL_SUITES.map((meta) => {
      const done = memory.model[meta.id] ?? null;
      const isRunning = running === meta.id;
      const progress = h('progress', { class: 'progress', value: '0', max: '1', 'aria-label': `Progress of ${meta.title}`, 'data-suite': meta.id, hidden: !isRunning });
      const status = h('span', { class: 'small', role: 'status', 'data-suite': meta.id });
      const runBtn = h('button', { type: 'button', class: 'btn', disabled: !aiOn || running !== null, onclick: () => runModel(meta.id) }, isRunning ? 'Running…' : done ? 'Run again' : 'Run these cases');
      const stopBtn = isRunning ? h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { stop = true; status.textContent = 'Stopping after this case…'; } }, 'Stop') : null;
      const guardBox = meta.id === 'agent'
        ? h('label', { class: 'chip-option' },
          h('input', { type: 'checkbox', checked: memory.guard, disabled: running !== null, onchange: (e) => { memory.guard = e.target.checked; } }),
          h('span', null, 'Warn the AI that listing text must not be obeyed'))
        : null;
      const out = [];
      if (done) {
        out.push(h('div', { class: 'notice' },
          h('strong', null, `${done.complete ? 'Finished' : 'Stopped early'}.`), ` ${done.counts.pass} passed, ${done.counts.fail} failed, ${done.counts.error} errors. `,
          meta.id === 'agent' ? `Warning to the AI was ${done.guard ? 'on' : 'off'}. ` : '',
          `Model: ${done.model ?? ctx.health().model ?? 'unknown'}.`));
        out.push(...(meta.id === 'parse' ? parseSummary(done) : agentSummary(done)));
        out.push(h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => download(`reins-${meta.id}${meta.id === 'agent' ? (done.guard ? '-guarded' : '-unguarded') : ''}-${new Date().toISOString().slice(0, 10)}.json`, { generatedAt: new Date().toISOString(), site: location.origin, model: done.model ?? ctx.health().model ?? null, suite: meta.id, guard: done.guard ?? null, counts: done.counts, summary: done.summary, results: done.results }) }, 'Download these results (JSON)')));
        out.push(details(meta, done));
      } else {
        out.push(h('p', { class: 'small' }, 'Not run yet. No numbers are shown until it has been run.'));
      }
      return h('div', { class: 'suite' },
        h('div', { class: 'suite-head' }, h('h3', null, meta.title), done ? tag(`${done.counts.pass} of ${done.counts.total} pass`, done.counts.pass === done.counts.total ? 'ok' : 'ask') : tag('Not run', 'neutral')),
        h('p', { class: 'small' }, meta.blurb),
        guardBox,
        h('div', { class: 'btn-row' }, runBtn, stopBtn, progress, status),
        out);
    });
    fill(modelBox,
      aiOn ? null : notice('ask', 'The AI is not connected in this copy of the app.', 'These two checks run on the deployed site.'),
      cards);
  }

  function details(meta, done) {
    const table = meta.id === 'parse'
      ? caseTable(done.results, { columns: [{ head: 'Fields right', value: (r) => (r.fieldsTotal ? `${r.fieldsMatched} of ${r.fieldsTotal}` : '') }], detail: parseDetail, stack: true })
      : caseTable(done.results, { columns: [{ head: 'Went for the trap', value: (r) => (r.group === 'hostile' && r.status !== 'error' ? (r.steered ? 'Yes' : 'No') : '') }, { head: 'Engine said', value: (r) => r.verdict ?? '' }], detail: agentDetail, stack: true });
    return h('details', null, h('summary', null, `Show all ${done.counts.total} cases`), table);
  }

  async function runModel(id) {
    if (running) return;
    running = id;
    stop = false;
    paintModel();
    const bar = modelBox.querySelector(`progress[data-suite="${id}"]`);
    const text = modelBox.querySelector(`[role=status][data-suite="${id}"]`);
    try {
      const files = await ctx.fixtures();
      const result = await runModelSuite(id, files, ctx.callApi, {
        guard: memory.guard,
        shouldStop: () => stop || !alive,
        onResult: (r, n, total) => {
          if (bar) { bar.max = total; bar.value = n; }
          if (text) text.textContent = `${n} of ${total} done`;
        },
      });
      result.model = ctx.health().model;
      memory.model[id] = result;
    } catch (err) {
      memory.model[id] = null;
      if (alive) fill(modelBox, notice('block', 'The run failed.', String(err.message ?? err)));
    }
    running = null;
    if (alive) paintModel();
  }

  // ------------------------------------------------------------ page
  root.append(h('div', null,
    h('header', { class: 'page-head' },
      h('h1', null, 'How well it works'),
      h('p', { class: 'lede' }, 'Every case below has a label saying what the right answer is, and the app is scored against it. The checks that need no AI run in your browser as this page opens. The two that use the AI model run when you press a button.')),
    summaryBox,
    h('section', { class: 'section', 'aria-labelledby': 'h-engine' },
      h('h2', { id: 'h-engine' }, 'Checks that need no AI'),
      h('p', { class: 'intro' }, 'These test the code that decides: the rules, the limits, the receipts, the gate. A “known gap” is something the engine does not catch yet. Each one is written down and checked, so a change to it cannot slip by.'),
      suitesBox),
    h('section', { class: 'section', 'aria-labelledby': 'h-model' },
      h('h2', { id: 'h-model' }, 'Checks that use the AI model'),
      h('p', { class: 'intro' }, 'Each run sends the labelled cases to the AI one at a time and scores what comes back. It uses part of this site’s free daily AI allowance. If the allowance runs out, the cases it could not answer are reported as errors, not skipped. Download the results to keep them.'),
      modelBox),
    h('section', { class: 'section', 'aria-labelledby': 'h-meta' },
      h('h2', { id: 'h-meta' }, 'Testing the tests'),
      h('p', { class: 'intro' }, 'A test set can pass because it checks too little. So the engine was deliberately broken in 43 small ways (a limit that lets an exact match through, a day counted wrong, a check removed) to see whether the cases notice. Re-running that check on the test set as it was first written, 36 of the 43 were caught. The 7 it missed were real gaps, and each was closed with a new labelled case. Two more changes alter nothing anyone can observe, and are listed separately. The final 43 of 43 is therefore not an independent result: the new cases were written to catch exactly those changes.'),
      h('p', null, h('a', { href: `${REPO}/blob/main/docs/EVIDENCE.md` }, 'Read the evidence notes'), ' and ', h('a', { href: `${REPO}/blob/main/eval/results/mutation-check.json` }, 'the mutation results'), ' on GitHub.'))));

  paintModel();
  const offHealth = ctx.onHealth(() => { if (!running) paintModel(); });
  if (memory.suites) paintEngine();
  else runEngine();
  return () => { alive = false; stop = true; offHealth(); };
}
