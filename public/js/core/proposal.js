// Turn the shopping agent's answer into a proposal the policy engine can judge.
//
// The agent is a model and its answer is untrusted. From it we take only a list
// of SKUs and quantities. The shop comes from the SKUs, the price of each line
// from the catalogue, and the total is our own sum: a price, a total or a shop
// the model states is never read. docs/SPEC.md section 11.

import { getItem, has } from './catalogue.js';

export const MAX_LINES = 20;
export const MAX_QTY = 99;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function failure(...errors) {
  return { ok: false, proposal: null, errors };
}

/** @returns {{ok: boolean, proposal: object|null, errors: {code: string, message: string, detail?: string[]}[]}} */
export function buildProposal(catalogue, agentOutput) {
  const lines = isObject(agentOutput) && has(agentOutput, 'items') ? agentOutput.items : null;
  if (!Array.isArray(lines) || lines.length === 0) {
    return failure({ code: 'NO_ITEMS', message: 'The agent did not choose any items.' });
  }
  if (lines.length > MAX_LINES) {
    return failure({ code: 'TOO_MANY_LINES', message: `An order may have at most ${MAX_LINES} lines.` });
  }

  const unknown = [];
  const badQty = [];
  const wanted = new Map(); // sku -> quantity, in first-seen order; repeated lines are merged
  for (const line of lines) {
    const sku = isObject(line) && has(line, 'sku') ? line.sku : undefined;
    const qty = isObject(line) && has(line, 'qty') ? line.qty : undefined;
    const item = typeof sku === 'string' ? getItem(catalogue, sku) : null;
    if (!item) {
      unknown.push(String(sku));
      continue;
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      badQty.push(sku);
      continue;
    }
    wanted.set(sku, (wanted.get(sku) ?? 0) + qty);
  }
  for (const [sku, qty] of wanted) if (qty > MAX_QTY) badQty.push(sku);

  const errors = [];
  if (unknown.length) errors.push({ code: 'UNKNOWN_SKU', message: 'Some items are not in the catalogue.', detail: unknown });
  if (badQty.length) errors.push({ code: 'BAD_QTY', message: `Each quantity must be a whole number from 1 to ${MAX_QTY}.`, detail: badQty });
  if (errors.length) return failure(...errors);

  const merchants = new Set([...wanted.keys()].map((sku) => getItem(catalogue, sku).merchantId));
  if (merchants.size > 1) {
    return failure({ code: 'MIXED_MERCHANTS', message: 'An order can only be for one shop.', detail: [...merchants] });
  }

  const items = [...wanted].map(([sku, qty]) => {
    const item = getItem(catalogue, sku);
    return { sku, qty, name: item.name, price: item.price, lineTotal: item.price * qty };
  });
  return {
    ok: true,
    errors: [],
    proposal: { merchantId: [...merchants][0], amount: items.reduce((total, i) => total + i.lineTotal, 0), items },
  };
}
