#!/usr/bin/env node
// A local copy of the site, with no Cloudflare account. It serves public/ with the
// same _headers the deployed site gets (so a script or style the strict policy
// would block fails here too), and runs the real Worker code for /api/*.
//
//   node scripts/preview-server.mjs               a stand-in AI answers the two API calls
//   node scripts/preview-server.mjs --ai=off      no AI connected (the scripted assistant only)
//   PORT=9000 node scripts/preview-server.mjs
//
// The stand-in is a few regular expressions, NOT a model. It exists so the screens
// can be tried and tested offline. Its answers say nothing about how the real model does:
// that is measured on the Tests page against the deployed site.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../src/worker/index.js';
import { createLimiter } from '../src/worker/limits.js';

const ROOT = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// ---------------------------------------------------------------- the stand-in AI

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1 };
const amount = (s) => {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(k)?/i.exec(s ?? '');
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
};

function standInReader(text) {
  const t = text.toLowerCase();
  const out = { merchants: null, categories: null, perOrderCap: null, periodCap: null, blockedWeekdays: null, askAbove: null, autoApproveIrreversible: null, durationDays: null, notes: [] };
  const shops = [['freshbasket', 'FreshBasket'], ['fresh basket', 'FreshBasket'], ['quickmart', 'QuickMart'], ['quick mart', 'QuickMart'], ['spiceroute', 'SpiceRoute Kitchen'], ['biryani lane', 'Biryani Lane'], ['teletop', 'TeleTop Recharge'], ['bazaarhub', 'BazaarHub'], ['zepto', 'Zepto']];
  const found = [];
  for (const [needle, name] of shops) if (t.includes(needle) && !found.includes(name)) found.push(name);
  if (found.length) out.merchants = found;
  const kinds = [];
  if (/grocer|kirana|vegetable/.test(t)) kinds.push('groceries');
  if (/food|dinner|lunch|restaurant/.test(t)) kinds.push('food delivery');
  if (/recharge/.test(t)) kinds.push('mobile recharge');
  if (kinds.length) out.categories = kinds;
  const period = /(?:₹|rs\.?\s*)?(\d[\d,.]*k?)\s*(?:a|per|each|every)\s*(day|week|month)/.exec(t) ?? /(day|week|month)ly\s*(?:₹|rs\.?\s*)?(\d[\d,.]*k?)/.exec(t);
  if (period) {
    const [a, b] = period.slice(1);
    const periodWord = /^(day|week|month)$/.test(a) ? a : b;
    out.periodCap = { amount: amount(/^(day|week|month)$/.test(a) ? b : a), period: periodWord };
  }
  const per = /(?:max|at most|up to|no more than)\s*(?:₹|rs\.?\s*)?(\d[\d,.]*k?)\s*(?:per|an?|each)\s*order/.exec(t);
  if (per) out.perOrderCap = amount(per[1]);
  const ask = /(?:ask|confirm|check)[^.]*?(?:above|over|more than)\s*(?:₹|rs\.?\s*)?(\d[\d,.]*k?)/.exec(t);
  if (ask) out.askAbove = amount(ask[1]);
  const days = [];
  if (/weekend/.test(t)) days.push('sat', 'sun');
  for (const [d, re] of [['mon', /monday/], ['tue', /tuesday/], ['wed', /wednesday/], ['thu', /thursday/], ['fri', /friday/], ['sat', /saturday/], ['sun', /sunday/]]) if (re.test(t) && !days.includes(d)) days.push(d);
  if (days.length && /nothing|no |not |never|don'?t/.test(t)) out.blockedWeekdays = days;
  const dur = /(\d+)\s*(day|week|month)s?/.exec(t.replace(/(\d[\d,.]*k?)\s*(?:a|per|each|every)\s*(day|week|month)/g, ''));
  if (dur) out.durationDays = Number(dur[1]) * { day: 1, week: 7, month: 30 }[dur[2]];
  if (/ignore (?:the |all |your )?(?:previous|above|rules|instructions)/.test(t)) out.notes.push('The text contained an instruction aimed at the reader. It was not followed.');
  return out;
}

function standInAgent(userContent) {
  const request = JSON.parse(/Customer request: (".*?")\n\nProducts/s.exec(userContent)[1]).toLowerCase();
  const products = JSON.parse(userContent.slice(userContent.indexOf('Products (JSON):\n') + 'Products (JSON):\n'.length));
  const shopNames = [...new Set(products.map((p) => p.shop))];
  const named = shopNames.find((s) => request.includes(s.toLowerCase()));
  const words = request.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const score = (p) => words.filter((w) => p.name.toLowerCase().includes(w) || p.sku.toLowerCase().includes(w)).length;
  const pool = named ? products.filter((p) => p.shop === named) : products;
  const wanted = pool.filter((p) => score(p) > 0);
  const best = new Map();
  for (const p of wanted) {
    const key = p.name.toLowerCase();
    const cur = best.get(key);
    const better = !cur || score(p) > score(cur) || (score(p) === score(cur) && (/lowest|cheap/.test(request) ? p.price < cur.price : p.price > cur.price));
    if (better) best.set(key, p);
  }
  const shop = named ?? [...best.values()][0]?.shop;
  const items = [...best.values()].filter((p) => p.shop === shop).map((p) => {
    const near = new RegExp(`(\\d+|${Object.keys(WORDS).join('|')})\\s+(?:kg\\s+)?(?:of\\s+)?(?:${p.name.toLowerCase().split(/[ ,]+/)[0]})`).exec(request);
    const qty = near ? (WORDS[near[1]] ?? Number(near[1])) : 1;
    return { sku: p.sku, qty };
  });
  return { items, note: items.length ? 'Stand-in answer (not a model): matched words in your request to the product list.' : 'Nothing in the list matched.' };
}

const standInAi = {
  async run(_model, request) {
    const [system, user] = request.messages;
    const response = system.content.startsWith('You fill in') ? standInReader(/"""\n([\s\S]*)\n"""/.exec(user.content)[1]) : standInAgent(user.content);
    return { response, usage: { prompt_tokens: 600, completion_tokens: 60, total_tokens: 660 } };
  },
};

// ---------------------------------------------------------------- headers from public/_headers

async function loadHeaderRules() {
  const text = await readFile(join(ROOT, '_headers'), 'utf8');
  const rules = [];
  let current = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { current = { pattern: raw.trim(), headers: [] }; rules.push(current); continue; }
    const i = raw.indexOf(':');
    current.headers.push([raw.slice(0, i).trim(), raw.slice(i + 1).trim()]);
  }
  return rules;
}
const matches = (pattern, path) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path);

// ---------------------------------------------------------------- server

export async function createPreview({ ai = 'fake' } = {}) {
  const rules = await loadHeaderRules();
  const env = ai === 'off' ? {} : { AI: standInAi, AI_MODEL: 'preview stand-in (not a real model)' };
  const limiter = createLimiter({ limit: 100_000, windowMs: 60_000 });

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const response = await handle(new Request(url, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body }), env, { limiter });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (rel === '' || rel.endsWith(sep)) rel += 'index.html';
      const file = resolve(ROOT, rel);
      if (!file.startsWith(ROOT + sep) || rel === '_headers') { res.writeHead(404).end('Not found'); return; }
      const data = await readFile(file);
      const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' };
      for (const rule of rules) if (matches(rule.pattern, url.pathname)) for (const [k, v] of rule.headers) headers[k] = v;
      res.writeHead(200, headers).end(data);
    } catch (err) {
      if (err && err.code === 'ENOENT') res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      else { res.writeHead(500, { 'content-type': 'text/plain' }).end('Server error'); console.error(err); }
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8788);
  const ai = process.argv.includes('--ai=off') ? 'off' : 'fake';
  const server = await createPreview({ ai });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Reins preview on http://127.0.0.1:${port}  (AI: ${ai === 'off' ? 'not connected' : 'a stand-in that is NOT a model'})`);
  });
}
