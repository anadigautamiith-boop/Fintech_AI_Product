// Product metrics, worked out from the ledger and from model call records.
// docs/SPEC.md section 10.
//
// North star: share of agent-made purchases the person keeps without undo.
// Guardrail: reversal rate. Every order in the ledger is an agent-made purchase
// that went through (the agent proposed it and it executed, or the person
// approved it), so "executed" is the ledger's length.
//
// Complaints per 10,000 decisions needs real users and is reported as not
// measured. Cost is reported as token counts, because the neuron price of a
// call depends on the model and is not worked out here.

/**
 * @param {{ledger: {status: string}[]}} state
 * @returns {{executed: number, kept: number, refunded: number, keptShare: number|null, reversalRate: number|null}}
 */
export function orderMetrics(state) {
  const executed = state.ledger.length;
  const refunded = state.ledger.filter((o) => o.status === 'refunded').length;
  const kept = executed - refunded;
  return {
    executed,
    kept,
    refunded,
    keptShare: executed === 0 ? null : kept / executed,
    reversalRate: executed === 0 ? null : refunded / executed,
  };
}

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * Token use across model calls. A call that did not report usage is counted
 * but adds no tokens, so `calls` can be larger than `reported`.
 * @param {{promptTokens?: number, completionTokens?: number}[]} calls
 */
export function modelUsage(calls) {
  let reported = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  for (const call of calls) {
    if (call && isCount(call.promptTokens) && isCount(call.completionTokens)) {
      reported += 1;
      promptTokens += call.promptTokens;
      completionTokens += call.completionTokens;
    }
  }
  return {
    calls: calls.length,
    reported,
    promptTokens,
    completionTokens,
    tokensPerCall: reported === 0 ? null : (promptTokens + completionTokens) / reported,
  };
}

/** Metrics the product cannot measure without real users. */
export const NOT_MEASURED = ['complaints per 10,000 decisions'];
