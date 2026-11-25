// Calls to the Worker. Never throws: a failure comes back as {ok: false, error, message}
// so the app can say what happened and fall back to the form and the scripted agent.

export async function callApi(path, body) {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }
    if (json && typeof json === 'object') return { ...json, ok: json.ok === true, status: res.status };
    return { ok: false, error: 'bad_response', message: `The server answered with status ${res.status}.`, status: res.status };
  } catch {
    return { ok: false, error: 'network', message: 'Could not reach the server.' };
  }
}

/** Is the AI connected on this deployment? A failure means "no". */
export async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const json = await res.json();
    return { ok: json.ok === true, ai: json.ai === true, model: json.model ?? null };
  } catch {
    return { ok: false, ai: false, model: null };
  }
}

/** Plain-language message for a failed AI call. */
export function explainFailure(result) {
  switch (result.error) {
    case 'ai_unavailable':
      return result.reason === 'quota'
        ? 'The free daily AI allowance for this demo is used up. Everything else still works, and the AI is back after the daily reset.'
        : result.reason === 'no_binding'
          ? 'No AI is connected to this copy of the app.'
          : 'The AI is not available right now.';
    case 'bad_output':
      return 'The AI answered in a form that could not be read, so nothing was changed.';
    case 'rate_limited':
      return 'Too many requests in a short time. Wait a minute and try again.';
    case 'forbidden_origin':
      return 'The AI can only be used from the app’s own page.';
    case 'network':
      return 'Could not reach the server. Check your connection.';
    case 'bad_request':
      return result.message || 'The request was not accepted.';
    default:
      return result.message || 'Something went wrong.';
  }
}
