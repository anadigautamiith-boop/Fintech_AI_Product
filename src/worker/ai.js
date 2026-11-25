// One place that talks to Workers AI.
//
// Asks for JSON in schema mode first. If that fails for a reason other than a
// used-up allowance or a busy service, asks once more without a schema and
// pulls the JSON out of the text. Whatever comes back is returned as-is for
// the caller to validate; nothing here decides whether it is believed.

export const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export class ModelError extends Error {
  /** @param {'ai_unavailable'|'bad_output'} code @param {string} message @param {string} reason */
  constructor(code, message, reason) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
    this.reason = reason;
  }
}

function classify(err) {
  const text = String(err?.message ?? err ?? '');
  if (/couldn'?t be met|could not be met/i.test(text)) return new ModelError('bad_output', 'The model did not return valid JSON.', 'json_mode');
  if (/4006|daily free allocation|neurons/i.test(text)) return new ModelError('ai_unavailable', 'The free daily AI allowance is used up.', 'quota');
  if (/3040|capacity|overloaded/i.test(text)) return new ModelError('ai_unavailable', 'The AI service is busy. Try again in a moment.', 'busy');
  return new ModelError('ai_unavailable', 'The AI call failed.', 'error');
}

/** Parse JSON that may be wrapped in a code fence or in a sentence. */
export function parseLooseJson(text) {
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  const attempts = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) attempts.push(fenced[1].trim());
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) attempts.push(trimmed.slice(first, last + 1));
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next shape */
    }
  }
  return undefined;
}

function extract(result) {
  const raw = result !== null && typeof result === 'object' && 'response' in result ? result.response : result;
  const output = typeof raw === 'string' ? parseLooseJson(raw) : raw;
  const u = result?.usage;
  const usage =
    u && Number.isSafeInteger(u.prompt_tokens) && Number.isSafeInteger(u.completion_tokens)
      ? { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens }
      : null;
  return { output, usage };
}

/**
 * @param {{AI?: {run: Function}, AI_MODEL?: string}} env
 * @param {{messages: object[], schema: object, maxTokens: number}} options
 * @returns {Promise<{output: object, usage: {promptTokens: number, completionTokens: number}|null, mode: 'json_schema'|'plain', model: string}>}
 */
export async function runJson(env, { messages, schema, maxTokens }) {
  if (!env || !env.AI || typeof env.AI.run !== 'function') {
    throw new ModelError('ai_unavailable', 'No AI is connected to this deployment.', 'no_binding');
  }
  const model = env.AI_MODEL || DEFAULT_MODEL;
  let lastError = null;
  for (const mode of ['json_schema', 'plain']) {
    const request = { messages, max_tokens: maxTokens, temperature: 0 };
    if (mode === 'json_schema') request.response_format = { type: 'json_schema', json_schema: schema };
    try {
      const result = await env.AI.run(model, request);
      const { output, usage } = extract(result);
      if (output === null || typeof output !== 'object') throw new ModelError('bad_output', 'The model did not return a JSON object.', 'parse');
      return { output, usage, mode, model };
    } catch (err) {
      const error = err instanceof ModelError ? err : classify(err);
      lastError = error;
      if (error.code === 'ai_unavailable' && (error.reason === 'quota' || error.reason === 'busy')) throw error;
    }
  }
  throw lastError;
}
