// The page shell: hash router, the simulated clock in the masthead, the
// "is the AI connected" check, and loading of the labelled test files.

import * as store from './store.js';
import { CATALOGUE } from './core/catalogue-data.js';
import { suiteFiles } from './core/suites.js';
import { callApi, checkHealth, explainFailure } from './api.js';
import { h, fill } from './ui/dom.js';
import { formatTime, toLocalInput, fromLocalInput } from './ui/format.js';
import { nextWeekdayAt10, defaultClock } from './logic.js';

const MINUTE = 60_000;
const ROUTES = {
  rules: { label: 'Rules', load: () => import('./views/rules.js') },
  shop: { label: 'Shop', load: () => import('./views/shop.js') },
  evidence: { label: 'Evidence', load: () => import('./views/evidence.js') },
  tests: { label: 'Tests', load: () => import('./views/tests.js') },
  about: { label: 'About', load: () => import('./views/about.js') },
};

const main = document.getElementById('main');
const state = { health: { ok: false, ai: false, model: null, checked: false }, fixturesPromise: null };
const healthListeners = new Set();

export const ctx = {
  store,
  catalogue: CATALOGUE,
  callApi,
  explainFailure,
  health: () => state.health,
  onHealth: (fn) => { healthListeners.add(fn); return () => healthListeners.delete(fn); },
  go: (route) => { location.hash = `#/${route}`; },
  /** The labelled test files, fetched once. Rejects with a readable error. */
  fixtures() {
    if (!state.fixturesPromise) {
      state.fixturesPromise = Promise.all(suiteFiles().map(async (name) => {
        const res = await fetch(`/data/tests/${name}.json`);
        if (!res.ok) throw new Error(`Could not load the test file ${name}.json (status ${res.status}).`);
        return [name, await res.json()];
      })).then((pairs) => Object.fromEntries(pairs)).catch((err) => { state.fixturesPromise = null; throw err; });
    }
    return state.fixturesPromise;
  },
};

// ---------------------------------------------------------------- routing

let unmount = null;
let renderToken = 0;
let firstRender = true;

function routeFromHash() {
  const m = /^#\/([a-z]+)/.exec(location.hash);
  return m && ROUTES[m[1]] ? m[1] : 'rules';
}

async function show() {
  const route = routeFromHash();
  const token = ++renderToken;
  if (unmount) { unmount(); unmount = null; }
  for (const a of document.querySelectorAll('#tabs a')) {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = `${ROUTES[route].label} · Reins: an AI shopping assistant on a short lead`;
  fill(main, h('p', { class: 'loading' }, 'Loading'));
  try {
    const view = await ROUTES[route].load();
    if (token !== renderToken) return; // the person moved on while this was loading
    fill(main);
    unmount = view.mount(main, ctx) ?? null;
  } catch (err) {
    if (token !== renderToken) return;
    fill(main, h('div', { class: 'notice notice-block', role: 'alert' }, h('strong', null, 'This page could not be shown.'), ' ', String(err && err.message ? err.message : err), ' Reload the page to try again.'));
  }
  if (!firstRender) {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
  firstRender = false;
}

// ---------------------------------------------------------------- the clock

function mountClock() {
  const host = document.getElementById('clock');
  let open = false;
  const button = h('button', { type: 'button', class: 'clock-button', 'aria-expanded': 'false', 'aria-controls': 'clock-panel', onclick: () => toggle(!open) });
  const panel = h('div', { class: 'clock-panel', id: 'clock-panel', role: 'group', 'aria-label': 'Simulated clock', hidden: true });
  host.append(button, panel);

  const input = h('input', { type: 'datetime-local', id: 'clock-input', 'aria-describedby': 'clock-help' });
  const setBtn = h('button', { type: 'button', class: 'btn btn-small', onclick: () => {
    const ms = fromLocalInput(input.value);
    if (ms !== null) store.setClock(ms);
  } }, 'Set');
  const bump = (label, ms) => h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => store.advanceClock(ms) }, label);
  const now = h('p', { class: 'clock-now' });
  fill(panel,
    h('p', { id: 'clock-help' }, 'This clock only moves when you move it. Limits, blocked days and undo windows all read it, so you can test them without waiting.'),
    now,
    h('div', { class: 'clock-grid' },
      bump('+5 minutes', 5 * MINUTE), bump('+1 hour', 60 * MINUTE), bump('+1 day', 24 * 60 * MINUTE),
      h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => store.setClock(nextWeekdayAt10(store.get().clockMs, 'sat')) }, 'Next Saturday, 10:00'),
      h('button', { type: 'button', class: 'btn btn-quiet btn-small', onclick: () => store.setClock(defaultClock(Date.now())) }, 'Back to a weekday morning')),
    h('div', { class: 'clock-set' }, h('div', { class: 'field' }, h('label', { for: 'clock-input' }, 'Or pick a time (IST)'), input), setBtn));

  function toggle(next) {
    open = next;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { toggle(false); button.focus(); } });
  document.addEventListener('click', (e) => { if (open && !host.contains(e.target)) toggle(false); });

  const paint = (s) => {
    button.textContent = `Simulated time: ${formatTime(s.clockMs)} IST`;
    now.textContent = `Now: ${formatTime(s.clockMs)} IST`;
    if (document.activeElement !== input) input.value = toLocalInput(s.clockMs);
  };
  paint(store.get());
  store.subscribe(paint);
}

// ---------------------------------------------------------------- start again

function mountStartAgain() {
  const host = document.getElementById('start-again');
  const idle = () => fill(host, h('button', { type: 'button', class: 'link-button', onclick: confirmStep }, 'Start again from nothing'));
  function confirmStep() {
    const yes = h('button', { type: 'button', class: 'btn btn-light', onclick: () => { store.resetAll(); idle(); show(); } }, 'Yes, wipe it');
    fill(host, h('span', null, 'This clears your rules, orders and settings saved in this browser. '), yes, h('button', { type: 'button', class: 'btn btn-light', onclick: () => { idle(); } }, 'Keep them'));
    yes.focus();
  }
  idle();
}

// ---------------------------------------------------------------- boot

function paintHealth() {
  const badge = document.getElementById('ai-badge');
  const hl = state.health;
  badge.hidden = !hl.checked;
  badge.textContent = hl.ai ? 'AI connected' : 'AI not connected: scripted assistant only';
  for (const fn of [...healthListeners]) fn(hl);
}

async function boot() {
  mountClock();
  mountStartAgain();
  window.addEventListener('hashchange', show);
  await show();
  const hl = await checkHealth();
  state.health = { ...hl, checked: true };
  paintHealth();
}

boot();
