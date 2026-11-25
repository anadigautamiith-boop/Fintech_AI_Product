// The Worker: three small API routes in front of the static site.
//
//   GET  /api/health          is the AI connected, which model
//   POST /api/parse-mandate   plain text in, form fields out (mandate reader)
//   POST /api/agent           request in, a validated order out (shopping agent)
//
// Everything else is served from the static assets. The model's answers are
// untrusted: they pass through coerceParsed and buildProposal, the same code
// the browser and the tests use, before anything is believed.
// docs/SPEC.md section 11.

import { CATALOGUE } from '../../public/js/core/catalogue-data.js';
import { has } from '../../public/js/core/catalogue.js';
import { coerceParsed } from '../../public/js/core/coerce.js';
import { buildProposal } from '../../public/js/core/proposal.js';
import { AGENT_SCHEMA, MANDATE_SCHEMA, agentMessages, agentSlice, mandateMessages } from './prompts.js';
import { DEFAULT_MODEL, ModelError, runJson } from './ai.js';
import { createLimiter } from './limits.js';

export const LIMITS = {
  maxBodyChars: 8 * 1024,
  maxText: 1000,
  maxRequest: 300,
  maxSkus: 40,
  maxListing: 400,
  callsPerWindow: 60,
  windowMs: 10 * 60 * 1000,
};

const defaultLimiter = createLimiter({ limit: LIMITS.callsPerWindow, windowMs: LIMITS.windowMs });

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

const fail = (status, error, message, headers) => json(status, { ok: false, error, message }, headers);
const badRequest = (message) => fail(400, 'bad_request', message);

/** Reads a small JSON object from the body. Returns `{value}` or `{response}`. */
async function readJsonBody(request) {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!type.includes('application/json')) return { response: fail(415, 'unsupported_media_type', 'Send the request as application/json.') };
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > LIMITS.maxBodyChars) return { response: fail(413, 'too_large', 'The request is too large.') };
  const text = await request.text();
  if (text.length > LIMITS.maxBodyChars) return { response: fail(413, 'too_large', 'The request is too large.') };
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { response: badRequest('The body is not valid JSON.') };
  }
  if (!isPlainObject(value)) return { response: badRequest('The body must be a JSON object.') };
  return { value };
}

function modelFailure(err) {
  if (err instanceof ModelError) {
    if (err.code === 'bad_output') return fail(502, 'bad_output', 'The AI answered in a form that could not be read. Nothing was changed.');
    return json(503, { ok: false, error: 'ai_unavailable', reason: err.reason, message: err.message });
  }
  return json(503, { ok: false, error: 'ai_unavailable', reason: 'error', message: 'The AI call failed.' });
}

async function parseMandate(body, env) {
  const text = body.text;
  if (typeof text !== 'string' || text.trim().length === 0) return badRequest('Say what the assistant may buy: "text" is required.');
  if (text.length > LIMITS.maxText) return badRequest(`Keep the text under ${LIMITS.maxText} characters.`);
  try {
    const model = await runJson(env, { messages: mandateMessages(text), schema: MANDATE_SCHEMA, maxTokens: 700 });
    const { fields, unresolved, notes } = coerceParsed(model.output, CATALOGUE);
    return json(200, { ok: true, fields, unresolved, notes, raw: model.output, usage: model.usage, mode: model.mode, model: model.model });
  } catch (err) {
    return modelFailure(err);
  }
}

async function runAgent(body, env) {
  const { request: ask, guard = true } = body;
  if (typeof ask !== 'string' || ask.trim().length === 0) return badRequest('Say what to buy: "request" is required.');
  if (ask.length > LIMITS.maxRequest) return badRequest(`Keep the request under ${LIMITS.maxRequest} characters.`);
  if (typeof guard !== 'boolean') return badRequest('"guard" must be true or false.');

  const skus = body.skus === undefined ? Object.keys(CATALOGUE.items) : body.skus;
  if (!Array.isArray(skus) || skus.length === 0 || skus.length > LIMITS.maxSkus) return badRequest(`"skus" must list 1 to ${LIMITS.maxSkus} products.`);
  if (new Set(skus).size !== skus.length) return badRequest('"skus" must not repeat a product.');
  for (const sku of skus) if (typeof sku !== 'string' || !has(CATALOGUE.items, sku)) return badRequest('"skus" contains a product that is not in the catalogue.');

  const overrides = body.listingOverrides ?? {};
  if (!isPlainObject(overrides)) return badRequest('"listingOverrides" must be an object.');
  for (const [sku, text] of Object.entries(overrides)) {
    if (!skus.includes(sku)) return badRequest('"listingOverrides" names a product that is not in "skus".');
    if (typeof text !== 'string' || text.length > LIMITS.maxListing) return badRequest(`Each listing text must be text of at most ${LIMITS.maxListing} characters.`);
  }

  try {
    const model = await runJson(env, { messages: agentMessages(ask, agentSlice(skus, overrides), { guard }), schema: AGENT_SCHEMA, maxTokens: 400 });
    const built = buildProposal(CATALOGUE, model.output);
    return json(200, { ok: true, output: model.output, proposal: built.proposal, errors: built.errors, usage: model.usage, mode: model.mode, model: model.model, guard });
  } catch (err) {
    return modelFailure(err);
  }
}

/** Same-origin only: a browser page on another site must not be able to call this. */
function crossSite(request, url) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== url.host;
  } catch {
    return true;
  }
}

/**
 * @param {Request} request
 * @param {{AI?: object, ASSETS?: {fetch: Function}, AI_MODEL?: string}} env
 * @param {{limiter?: {check: Function}}} [options]
 */
export async function handle(request, env, { limiter = defaultLimiter } = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) {
    if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  }

  if (url.pathname === '/api/health') {
    if (request.method !== 'GET') return fail(405, 'method_not_allowed', 'Use GET.', { allow: 'GET' });
    return json(200, {
      ok: true,
      ai: Boolean(env?.AI),
      model: env?.AI_MODEL || DEFAULT_MODEL,
      catalogueVersion: CATALOGUE.version,
      limits: { callsPerWindow: LIMITS.callsPerWindow, windowMinutes: LIMITS.windowMs / 60000 },
    });
  }

  const routes = { '/api/parse-mandate': parseMandate, '/api/agent': runAgent };
  if (!has(routes, url.pathname)) return fail(404, 'not_found', 'No such route.');
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.', { allow: 'POST' });
  if (crossSite(request, url)) return fail(403, 'forbidden_origin', 'This API can only be called from this site.');

  const client = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const gate = limiter.check(client);
  if (!gate.ok) return fail(429, 'rate_limited', 'Too many requests. Please wait a moment.', { 'retry-after': String(gate.retryAfterSec) });

  const read = await readJsonBody(request);
  if (read.response) return read.response;
  return routes[url.pathname](read.value, env);
}

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
