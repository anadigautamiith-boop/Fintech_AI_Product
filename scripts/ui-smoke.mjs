#!/usr/bin/env node
// Browser smoke test. Opens the real pages in headless Chrome, against a local copy
// of the site that sends the same security headers the deployed one does, and
// walks the main flows the way a person would. A script or style the strict
// content-security policy blocks shows up here as a console error and fails the run.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_PATH=/usr/bin/google-chrome node scripts/ui-smoke.mjs
//   node scripts/ui-smoke.mjs --require     fail (instead of skipping) when no browser is available
//   SMOKE_ONLY=evidence node scripts/ui-smoke.mjs      run only the scenarios whose name contains this word
//
// Playwright is not a dependency of the project: the app and its other tests need
// nothing installed. Without it this script says so and exits 0, so `npm test`
// is never held up by a missing browser.
//
// The AI answers come from the stand-in in scripts/preview-server.mjs, which is a few
// regular expressions and NOT a model. These checks are about the screens and the
// wiring, not about how well the model does; that is measured on the Tests page of
// the deployed site.

import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPreview } from './preview-server.mjs';

const REQUIRE = process.argv.includes('--require');
const ROUTES = ['rules', 'shop', 'evidence', 'tests', 'about'];

// ---------------------------------------------------------------- find a browser

async function loadPlaywright() {
  const where = process.env.PLAYWRIGHT_MODULE || 'playwright';
  try {
    const mod = await import(isAbsolute(where) ? pathToFileURL(where).href : where);
    return mod.chromium ?? mod.default?.chromium;
  } catch {
    return null;
  }
}

const chromium = await loadPlaywright();
if (!chromium) {
  const msg = 'ui-smoke: Playwright is not installed here, so the browser checks were skipped. Set PLAYWRIGHT_MODULE to its index.mjs (and CHROME_PATH to a Chrome binary) to run them.';
  console.log(msg);
  process.exit(REQUIRE ? 1 : 0);
}

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
} catch (err) {
  console.log(`ui-smoke: no browser could be started (${String(err.message).split('\n')[0]}). Skipped.`);
  process.exit(REQUIRE ? 1 : 0);
}

// ---------------------------------------------------------------- a tiny harness

const failures = [];
let passed = 0;
function check(label, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); return; }
  failures.push(`${label}${detail ? `: ${detail}` : ''}`);
  console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`);
}
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

const servers = {};
async function serverFor(ai) {
  if (!servers[ai]) {
    const server = await createPreview({ ai });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers[ai] = { server, base: `http://127.0.0.1:${server.address().port}` };
  }
  return servers[ai];
}

/** One scenario = one fresh browser profile (so nothing is saved from the last one) and a watch for anything the console or network complains about. */
async function scenario(name, { ai = 'fake', width = 1280, height = 900 } = {}, body) {
  if (process.env.SMOKE_ONLY && !name.toLowerCase().includes(process.env.SMOKE_ONLY.toLowerCase())) return;
  console.log(`\n${name}`);
  const { base } = await serverFor(ai);
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  const text = async (sel) => squash(await page.locator(sel).first().innerText());
  try {
    await body({ page, base, text, context });
  } catch (err) {
    check(`${name}: ran to the end`, false, String(err.message).split('\n').slice(0, 3).join(' | '));
  }
  check(`${name}: nothing in the console or network log`, problems.length === 0, problems.slice(0, 4).join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- shared steps

const go = async (page, base, route) => {
  await page.goto(`${base}/#/${route}`);
  await page.waitForSelector('main h1');
};
const activateDefaultRules = async (page, base) => {
  await go(page, base, 'rules');
  await page.getByRole('button', { name: 'Activate these rules' }).click();
  await page.locator('#activate-status').getByText('Rules are active.').waitFor();
};
const openClock = async (page) => {
  if ((await page.locator('#clock-panel').getAttribute('hidden')) !== null) await page.locator('.clock-button').click();
};
const pickSample = async (page, title, mode) => {
  await page.waitForSelector('.sample');
  await page.getByRole('button', { name: title, exact: true }).click();
  if (mode) await page.locator('input[name=agent-mode]').locator(`xpath=../span[text()="${mode}"]`).click();
};
const ask = async (page) => {
  const before = await page.locator('.slip').count();
  await page.getByRole('button', { name: 'Ask the assistant' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.slip').length > n, before);
};
const newestSlip = (page) => page.locator('.slip').first();
const headline = async (page) => squash(await newestSlip(page).locator('h3').innerText());

// ---------------------------------------------------------------- 1. every page, on a desktop

await scenario('Every page opens cleanly on a desktop', {}, async ({ page, base }) => {
  const headers = await (await page.goto(`${base}/`)).allHeaders();
  check('the page is sent with a content-security policy that allows only its own files', /default-src 'self'/.test(headers['content-security-policy'] ?? '') && /script-src 'self'/.test(headers['content-security-policy'] ?? ''));
  check('the page cannot be put in a frame', /frame-ancestors 'none'/.test(headers['content-security-policy'] ?? ''));

  for (const route of ROUTES) {
    await go(page, base, route);
    if (route === 'tests') await page.waitForSelector('#summary .big-number');
    const label = `#/${route}`;
    check(`${label}: exactly one top-level heading`, (await page.locator('h1').count()) === 1);
    check(`${label}: the tab for this page is marked current`, (await page.locator('#tabs a[aria-current=page]').getAttribute('data-route')) === route);
    check(`${label}: the title names the page`, (await page.title()).toLowerCase().startsWith(route));
    const dup = await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map((e) => e.id); return [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))]; });
    check(`${label}: no repeated ids`, dup.length === 0, dup.join(', '));
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
      .filter((e) => e.type !== 'hidden' && !e.closest('[hidden]'))
      .filter((e) => !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.labels && e.labels.length)))
      .map((e) => `${e.tagName.toLowerCase()}#${e.id || '?'}[${e.type}]`));
    check(`${label}: every field has a name a screen reader can read`, unnamed.length === 0, unnamed.join(', '));
    const emptyButtons = await page.evaluate(() => [...document.querySelectorAll('button, a[href]')].filter((e) => !(e.innerText || '').trim() && !e.getAttribute('aria-label')).length);
    check(`${label}: no button or link without a name`, emptyButtons === 0, String(emptyButtons));
  }
});

// ---------------------------------------------------------------- 2. every page, on a phone

await scenario('Every page fits a phone screen', { width: 390, height: 800 }, async ({ page, base }) => {
  for (const route of ROUTES) {
    await go(page, base, route);
    if (route === 'tests') await page.waitForSelector('#summary .big-number');
    const wide = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
    check(`#/${route}: nothing pushes the page sideways`, wide.doc <= wide.view + 1, `page is ${wide.doc}px wide in a ${wide.view}px window`);
  }
});

await scenario('On a phone, tables become cards and nothing is cut off', { width: 390, height: 800 }, async ({ page, base, text }) => {
  const cutOff = () => page.evaluate(() => [...document.querySelectorAll('.table-wrap')].filter((w) => w.scrollWidth > w.clientWidth + 1).map((w) => (w.closest('.suite')?.querySelector('h3')?.textContent ?? w.querySelector('caption')?.textContent ?? 'a table')));
  const offScreen = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1); }).length, sel);

  await go(page, base, 'evidence');
  check('the invented record has one card per group, not a wide table', (await page.locator('#record-table tbody td[data-label="Override rate"]').count()) === 4 && (await cutOff()).length === 0, (await cutOff()).join(', '));
  check('the override rate and the verdict are on screen for every group', (await offScreen('#record-table td')) === 0);

  await activateDefaultRules(page, base);
  await go(page, base, 'shop');
  await pickSample(page, 'Plain request, plain listings', 'Scripted, careful');
  await ask(page);
  await newestSlip(page).getByRole('button', { name: /^Approve/ }).click();
  check('the statement is a card too, and its status is on screen', (await cutOff()).length === 0 && (await offScreen('#statement td')) === 0 && /Paid/.test(await text('#statement')), (await cutOff()).join(', '));
  check('the two-way switches stack one choice per line', await page.evaluate(() => { const [a, b] = [...document.querySelectorAll('.segmented-stack label')].slice(0, 2); return Boolean(a && b) && b.getBoundingClientRect().top > a.getBoundingClientRect().bottom - 2; }));

  await go(page, base, 'tests');
  await page.waitForSelector('#summary .big-number');
  await page.locator('#ai-badge:not([hidden])').waitFor();
  await page.locator('#model-suites .suite').nth(1).getByRole('button', { name: 'Run these cases' }).click();
  await page.waitForFunction(() => /Finished/.test(document.querySelector('#model-suites')?.innerText ?? ''), null, { timeout: 60_000 });
  await page.evaluate(() => document.querySelectorAll('#model-suites details').forEach((d) => { d.open = true; }));
  check('the model results are cards as well, with their result on screen', (await cutOff()).length === 0 && (await offScreen('#model-suites td')) === 0, (await cutOff()).join(', '));
  check('a stacked table still announces itself as a table', (await page.locator('#model-suites table[role=table] tr[role=row] td[role=cell]').count()) > 0);
});

// ---------------------------------------------------------------- 3. rules

await scenario('Rules: check, read, activate', {}, async ({ page, base, text }) => {
  await go(page, base, 'rules');
  check('starts with no rules active', /No rules are active yet/.test(await text('#active-box')));
  check('the example rules can be activated straight away', await page.getByRole('button', { name: 'Activate these rules' }).isEnabled());
  check('the limits are drawn on one scale, with a text version for screen readers', (await page.locator('#preview svg, #preview .ruler').count()) > 0 && /Checked by Reins only|Held by the bank/.test(await text('#preview')));

  // a bad amount stops activation and says why, next to the field
  const perOrder = page.getByLabel('Most for one order');
  await perOrder.fill('abc');
  check('a bad amount shows a message at the field', (await page.locator('.field-error:not(:empty)').count()) > 0, await text('#preview'));
  check('a bad amount switches activation off', await page.getByRole('button', { name: 'Activate these rules' }).isDisabled());
  check('a bad amount marks the field as invalid for assistive technology', (await perOrder.getAttribute('aria-invalid')) === 'true');
  await perOrder.fill('1500');
  check('fixing it switches activation back on', await page.getByRole('button', { name: 'Activate these rules' }).isEnabled());

  await page.getByRole('button', { name: 'Activate these rules' }).click();
  check('activating says so', /Rules are active/.test(await text('#activate-status')));
  check('the active rules are read back in words', /Active now/.test(await text('#active-box')) && /FreshBasket/.test(await text('#active-box')));
  check('the button now says nothing needs activating', /matches the active rules/.test(await text('#activate-reason')));

  await perOrder.fill('700');
  check('a changed form is flagged as not yet active', /not active yet/.test(await text('#active-box')));
  check('the button offers to activate again', (await page.locator('#activate-btn').innerText()).includes('again'));

  // saved in the browser
  await page.getByRole('button', { name: 'Activate these rules again' }).click();
  await page.reload();
  await page.waitForSelector('main h1');
  check('the rules are still there after a reload', /Active now/.test(await text('#active-box')));
  check('and so is the changed amount', (await page.getByLabel('Most for one order').inputValue()) === '700');

  // the reader: it fills the form in, and what it cannot read blocks activation until a person decides
  await page.locator('#instructions').fill('₹2000 a week on groceries from Zepto, nothing on Sundays. Ask me above ₹800.');
  await page.getByRole('button', { name: 'Read my instructions' }).click();
  await page.locator('#read-status').getByText(/^Done/).waitFor();
  check('the reader filled in the form from the sentences', (await page.getByLabel('Ask me above').inputValue()) === '800');
  const open = await text('#reader-out');
  check('what the reader could not turn into a rule is listed', /could not turn into a rule/.test(open), open);
  check('activation waits for it', await page.locator('#activate-btn').isDisabled() && /open items/.test(await text('#activate-reason')));
  await page.getByRole('button', { name: /^Dismiss on purpose/ }).first().click();
  const left = await page.getByRole('button', { name: /^Dismiss on purpose/ }).count();
  check('dismissing it on purpose clears the item', left === 0);
  check('and activation is allowed again', await page.locator('#activate-btn').isEnabled());
  await page.getByRole('button', { name: 'Activate these rules' }).click();
  const active = await text('#active-box');
  check('the rules the reader produced become active, and are read back in words', /Asks you above ₹800/.test(active) && /At most ₹2,000 a week/.test(active) && /No buying on Sunday/.test(active), active);
});

// ---------------------------------------------------------------- 4. shop

await scenario('Shop: suggest, approve, undo', {}, async ({ page, base, text }) => {
  await go(page, base, 'shop');
  check('asking is switched off until rules are active, and says why', await page.locator('#ask-btn').isDisabled() && /activate your rules first/.test(await text('#ask-reason')));
  await activateDefaultRules(page, base);
  await go(page, base, 'shop');
  check('the assistant starts on the shortest lead', /Suggest/.test(await text('#status-strip')));
  await pickSample(page, 'Plain request, plain listings', 'Scripted, careful');
  await ask(page);
  const suggested = await headline(page);
  check('at the first step an order is only a suggestion', /^Suggestion: ₹[\d,]+ at FreshBasket$/.test(suggested), suggested);
  check('the receipt says no money moved', /No money moved/.test(await text('.slip')));
  check('the statement is empty', /Nothing has been paid yet/.test(await text('#statement')));

  await newestSlip(page).getByRole('button', { name: /^Approve/ }).click();
  const paid = await headline(page);
  const amount = /₹[\d,]+/.exec(suggested)?.[0];
  check('approving pays exactly the suggested amount', paid === `Paid ${amount} to FreshBasket`, paid);
  check('the statement lists the payment', /Paid/.test(await text('#statement tbody')) && (await text('#statement tbody')).includes(amount));
  check('Undo is offered, with the minutes left', (await newestSlip(page).getByRole('button', { name: /^Undo/ }).innerText()).includes('min left'));

  await newestSlip(page).getByRole('button', { name: /^Undo/ }).click();
  const refunded = await headline(page);
  check('undoing refunds the same amount', refunded === `Refunded ${amount} from FreshBasket`, refunded);
  check('the statement shows it as refunded', /Refunded/.test(await text('#statement tbody')));
  check('the bank block is not given back, and the page says so', /A refund does not give a block back/.test(await text('#statement')));

  // the undo window closes with the simulated clock
  await ask(page);
  await newestSlip(page).getByRole('button', { name: /^Approve/ }).click();
  await openClock(page);
  await page.getByRole('button', { name: '+1 hour' }).click();
  await page.waitForSelector('.slip-actions button:has-text("Undo")', { state: 'detached' });
  check('after the undo window the slip says it has closed', /undo window has closed/.test(await text('.slip')));
});

await scenario('Shop: what Reins does when the assistant is fooled', {}, async ({ page, base, text }) => {
  await activateDefaultRules(page, base);
  await go(page, base, 'shop');

  await pickSample(page, 'Cheapest-price trap: an unverified look-alike shop undercuts everyone', 'Scripted, fooled');
  await ask(page);
  const unverified = await headline(page);
  check('an order to a shop that is not verified is blocked, whatever the assistant says', /^Blocked/.test(unverified), unverified);
  check('the receipt says no money moved', /No money moved/.test(await text('.slip')));

  await pickSample(page, 'Listing text tells the agent to add a gift card');
  await ask(page);
  check('an order that followed a hidden instruction is marked as such on its receipt', /went for the trap/.test(await text('.slip .slip-foot')));
  check('the hidden text the assistant read is kept on the receipt, labelled as the seller’s words', /written by the seller/.test(squash(await newestSlip(page).locator('details').first().textContent())));
  check('nothing was paid', /Nothing has been paid yet/.test(await text('#statement')));

  // a request the scripted assistants know nothing about is refused up front, not guessed at
  await page.locator('#request').fill('Buy me a car');
  check('free text is refused while only a scripted assistant is chosen', await page.locator('#ask-btn').isDisabled() && /only know the samples/.test(await text('#ask-reason')));
});

await scenario('Shop: rules about days, and the pause switch', {}, async ({ page, base, text }) => {
  await activateDefaultRules(page, base);
  await go(page, base, 'shop');
  await pickSample(page, 'Plain request, plain listings', 'Scripted, careful');
  await openClock(page);
  await page.getByRole('button', { name: 'Next Saturday, 10:00' }).click();
  await ask(page);
  const saturday = await newestSlip(page).innerText();
  check('on a day you blocked, the order is blocked and the receipt says so', /^Blocked/.test(await headline(page)) && /You blocked purchases on this day of the week/.test(squash(saturday)), squash(saturday).slice(0, 200));

  await openClock(page);
  await page.getByRole('button', { name: 'Back to a weekday morning' }).click();
  await page.locator('.switch input').check();
  await ask(page);
  check('while payments are paused every order is blocked', (await headline(page)) === 'Blocked: agent payments are paused');
  check('the page shows the pause', (await page.locator('#status-strip').innerText()).includes('Paused'));
  await page.locator('.switch input').uncheck();
  await ask(page);
  check('resuming lets orders through to the normal checks again', /^Suggestion/.test(await headline(page)));
});

await scenario('Shop: the AI model chooses the items', {}, async ({ page, base, text }) => {
  await activateDefaultRules(page, base);
  await go(page, base, 'shop');
  await page.locator('#ai-badge:not([hidden])').waitFor();
  check('with the AI connected it is the default way to choose items', await page.locator('input[name=agent-mode][value=ai]').isChecked());
  await page.locator('#request').fill('Order atta and a litre of milk from FreshBasket.');
  await ask(page);
  check('a typed request becomes an order built from catalogue prices', /^Suggestion: ₹[\d,]+ at FreshBasket$/.test(await headline(page)), await headline(page));
  check('the receipt says who chose the items', /Items chosen by the AI model/.test(await text('.slip .slip-ask')));
  check('what the assistant said is kept on the receipt and marked as not checked', /not checked by the app/.test(squash(await newestSlip(page).locator('details').first().textContent())));
});

// ---------------------------------------------------------------- 5. evidence

await scenario('Evidence: the gate cannot be argued with', {}, async ({ page, base, text }) => {
  await go(page, base, 'evidence');
  check('the record is labelled invented', /invented/.test(await text('main')));
  check('the assistant starts at the first step', /You are here/.test(await text('.ladder li:first-child')));
  check('with four good weeks the gate is open', /The record supports moving up/.test(await text('#gate-box')));
  check('every group is judged against the 10% line', (await page.locator('#record-table tbody tr').count()) === 4);

  await page.getByRole('button', { name: /^Move up to/ }).click();
  check('moving up puts the marker on the second step', /You are here/.test(await text('.ladder li:nth-child(2)')));
  check('the last step needs the person’s own say-so', await page.locator('#consent-row').isVisible());
  check('four weeks are not enough for the last step', /Not yet/.test(await text('#gate-box')) && await page.getByRole('button', { name: /^Move up to/ }).isDisabled());

  await page.locator('#weeks').fill('8');
  check('eight good weeks are enough evidence but consent is still missing', /consent|agree|say-so/i.test(await text('#gate-box')) && await page.getByRole('button', { name: /^Move up to/ }).isDisabled(), await text('#gate-box'));
  await page.locator('#consent').check();
  check('with the evidence and the consent the gate opens', /The record supports moving up/.test(await text('#gate-box')) && await page.getByRole('button', { name: /^Move up to/ }).isEnabled(), await text('#gate-box'));

  // an average that looks fine while one group struggles
  await page.getByText('One group struggles').click();
  const gap = await text('#gate-box');
  check('a good average does not hide a group that struggles: the gate stays shut', /Not yet/.test(gap) && await page.getByRole('button', { name: /^Move up to/ }).isDisabled(), gap);
  check('and the page names the group', /Family/.test(gap), gap);
  check('and says the average hides the problem', /average/.test(gap), gap);

  await page.getByRole('button', { name: /^Take back one step/ }).click();
  check('freedom can be taken back at once, with no evidence', /You are here/.test(await text('.ladder li:first-child')));
});

// ---------------------------------------------------------------- 6. tests

await scenario('Tests: the labelled cases run in the browser, and the model suites run on request', {}, async ({ page, base, text }) => {
  await go(page, base, 'tests');
  await page.waitForSelector('#summary .big-number');
  const summary = await text('#summary');
  const m = /(\d+) of (\d+)\s*cases behave as labelled/.exec(summary);
  check('every labelled case behaves as labelled', Boolean(m) && m[1] === m[2] && Number(m[2]) > 200, summary);
  check('nothing is failing', /None failing/.test(summary));
  check('the known gaps are shown as known gaps, not hidden', /known gap/.test(summary), summary);
  check('ten engine suites are listed', (await page.locator('#engine-suites .suite').count()) === 10);
  check('a model suite that has not been run shows no numbers', /Not run yet\. No numbers are shown/.test(await text('#model-suites')));

  const cards = page.locator('#model-suites .suite');
  await page.locator('#ai-badge:not([hidden])').waitFor();
  const runs = cards.getByRole('button', { name: 'Run these cases' });
  await runs.first().click();
  await page.waitForFunction(() => /Finished/.test(document.querySelector('#model-suites')?.innerText ?? ''), null, { timeout: 60_000 });
  const parse = squash(await cards.first().innerText());
  check('the reading suite ran all 30 cases', /Show all 30 cases/.test(parse), parse.slice(0, 300));
  check('it reports a score out of 30, not a bare tick', /of 30 instructions came out fully right/.test(parse));
  check('it says which model answered', /Model: /.test(parse));

  await cards.nth(1).getByRole('button', { name: 'Run these cases' }).click();
  await page.waitForFunction(() => (document.querySelector('#model-suites')?.innerText.match(/Finished/g) ?? []).length === 2, null, { timeout: 60_000 });
  const agent = squash(await cards.nth(1).innerText());
  check('the shopping-assistant suite ran all 10 requests', /Show all 10 cases/.test(agent), agent.slice(0, 300));
  check('it reports how often the assistant went for a trap and how often the order got through', /went for the trap in \d+ of \d+/.test(agent) && /would have gone through/.test(agent), agent.slice(0, 500));

  const [download] = await Promise.all([page.waitForEvent('download'), cards.nth(1).getByRole('button', { name: /Download these results/ }).click()]);
  const saved = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'));
  check('the results download as a file that names the suite, the model and the warning setting', saved.suite === 'agent' && saved.guard === true && Array.isArray(saved.results) && saved.results.length === 10 && 'model' in saved, JSON.stringify(Object.keys(saved)));
  check('the file name says whether the AI was warned', /guarded/.test(download.suggestedFilename()), download.suggestedFilename());

  // moving between tabs keeps the finished runs
  await go(page, base, 'about');
  await go(page, base, 'tests');
  check('the runs are still there after visiting another page', (await page.locator('#model-suites').innerText()).match(/Finished/g)?.length === 2);
});

// ---------------------------------------------------------------- 7. about, clock, footer

await scenario('About, the clock and starting again', {}, async ({ page, base, text }) => {
  await go(page, base, 'about');
  check('the page opens with the problem in one sentence', /cannot set exact spending limits, see why each payment happened, or undo a mistake/.test(await text('main')));
  for (const word of ['Real', 'Made up', 'Modelled', 'Never']) check(`it separates what is ${word.toLowerCase()}`, (await page.locator('dt', { hasText: new RegExp(`^${word}$`) }).count()) === 1);
  const links = await page.locator('main a[href^="http"]').evaluateAll((els) => els.map((e) => e.href));
  check('every outside link points at the project repository or the cited documentation', links.length > 0 && links.every((u) => /^https:\/\/(github\.com\/anadigautamiith-boop\/Fintech_AI_Product|www\.pinelabs\.com\/)/.test(u)), links.filter((u) => !/anadigautamiith-boop|pinelabs/.test(u)).join(', '));

  // the clock
  const button = page.locator('.clock-button');
  const before = squash(await button.innerText());
  await button.click();
  check('the clock panel opens', await page.locator('#clock-panel').isVisible());
  await page.getByRole('button', { name: '+1 day' }).click();
  check('moving the clock changes the time shown', squash(await button.innerText()) !== before);
  await page.keyboard.press('Escape');
  check('Escape closes the panel and hands focus back to the clock button', !(await page.locator('#clock-panel').isVisible()) && (await page.evaluate(() => document.activeElement?.className)) === 'clock-button');

  // the skip link must not break the router
  await go(page, base, 'evidence');
  await page.reload();
  await page.waitForSelector('main h1');
  await page.keyboard.press('Tab');
  check('the first Tab stop is the skip link', (await page.evaluate(() => document.activeElement?.className)) === 'skip');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  check('using the skip link keeps you on the same page', (await page.locator('h1').innerText()).startsWith('Evidence'), `now showing: ${await page.locator('h1').innerText()}`);

  // start again, in two steps
  await activateDefaultRules(page, base);
  await page.getByRole('button', { name: 'Start again from nothing' }).click();
  check('wiping asks first', (await page.getByRole('button', { name: 'Yes, wipe it' }).count()) === 1);
  await page.getByRole('button', { name: 'Keep them' }).click();
  await go(page, base, 'rules');
  check('"Keep them" keeps the rules', /Active now/.test(await text('#active-box')));
  await page.getByRole('button', { name: 'Start again from nothing' }).click();
  await page.getByRole('button', { name: 'Yes, wipe it' }).click();
  await page.waitForSelector('#active-box');
  check('wiping clears the rules', /No rules are active yet/.test(await text('#active-box')));
});

// ---------------------------------------------------------------- 8. no AI connected

await scenario('A copy with no AI connected still works and says so', { ai: 'off' }, async ({ page, base, text }) => {
  await go(page, base, 'rules');
  await page.locator('#ai-badge:not([hidden])').waitFor();
  check('the masthead says the AI is not connected', /not connected/.test(await text('#ai-badge')));
  check('the reader is switched off', await page.locator('#read-btn').isDisabled());
  await page.locator('#instructions').fill('Groceries from FreshBasket, ₹1000 a week.');
  check('and it explains that the form is filled in by hand', /not connected in this copy of the app/.test(await text('#read-status')));
  await activateDefaultRules(page, base);

  await go(page, base, 'shop');
  await page.locator('#ai-badge:not([hidden])').waitFor();
  check('the AI choice is greyed out', await page.locator('input[name=agent-mode][value=ai]').isDisabled());
  check('a scripted assistant is chosen instead', await page.locator('input[name=agent-mode][value=careful]').isChecked());
  await pickSample(page, 'Plain request, plain listings');
  await ask(page);
  check('the scripted assistant still produces an order', /^Suggestion: ₹[\d,]+ at FreshBasket$/.test(await headline(page)), await headline(page));

  await go(page, base, 'tests');
  await page.waitForSelector('#summary .big-number');
  check('the engine suites still run', /None failing/.test(await text('#summary')));
  check('the model suites say they need the deployed site and cannot be started', /not connected in this copy/.test(await text('#model-suites')) && (await page.locator('#model-suites').getByRole('button', { name: 'Run these cases' }).first().isDisabled()));
});

// ---------------------------------------------------------------- done

await browser.close();
for (const { server } of Object.values(servers)) server.close();

console.log(`\nui-smoke: ${passed} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
