// Compile a mandate into what a UPI Reserve Pay style rail can hold.
// The rail only knows a merchant, an amount and an expiry (docs/SPEC.md
// section 3). Everything else in the mandate is enforced by this layer, and
// the compile step says which is which, so the person is not told the bank
// is protecting them where only the layer is.

import { formatRupees } from './money.js';

export const BLOCK_LIMIT = 10000;
const PERIOD_DAYS = { day: 1, week: 7, month: 30 };

function warning(code, message) {
  return { code, message };
}

/**
 * @param {object} mandate a normalised mandate
 * @param {{maxActiveBlocks: number}} bank how many blocks the bank lets a customer hold at once
 */
export function compileMandate(mandate, bank) {
  const days = mandate.durationDays;
  const merchants = mandate.merchants ?? [];
  const potentialSpend = mandate.periodCap
    ? Math.ceil(days / PERIOD_DAYS[mandate.periodCap.period]) * mandate.periodCap.amount
    : null;
  const blockSize = merchants.length ? Math.min(BLOCK_LIMIT, potentialSpend ?? BLOCK_LIMIT) : null;

  const room = Math.max(0, Math.floor(bank.maxActiveBlocks));
  const backed = merchants.slice(0, room);
  const unbacked = merchants.slice(room);
  const blocks = backed.map((merchantId) => ({ merchantId, limit: blockSize, validUntil: mandate.validUntil }));

  const renewalsNeeded =
    potentialSpend !== null && blocks.length > 0 ? Math.max(0, Math.ceil(potentialSpend / BLOCK_LIMIT) - 1) : null;

  const warnings = [];
  if (!mandate.merchants) {
    warnings.push(warning('ANY_MERCHANT_NOT_RAIL_BACKABLE', 'No shop is named, so the bank cannot hold a block. Every order will need your approval.'));
  }
  if (unbacked.length) {
    warnings.push(warning('BANK_BLOCK_LIMIT', `Your bank allows ${room} active payment ${room === 1 ? 'block' : 'blocks'} at a time, so ${unbacked.length} of your shops will have no block. Orders there will need your approval.`));
  }
  if (blocks.length && !mandate.periodCap) {
    warnings.push(warning('NO_PERIOD_CAP', `There is no period limit, so only the ${formatRupees(BLOCK_LIMIT)} payment block caps total spending.`));
  }
  if (potentialSpend !== null && blocks.length && blocks.length * blockSize > potentialSpend) {
    warnings.push(warning('RAIL_EXPOSURE_EXCEEDS_MANDATE', `The payment blocks together allow ${formatRupees(blocks.length * blockSize)}, more than your own limits allow (${formatRupees(potentialSpend)}). Only this app enforces the lower figure.`));
  }
  if (renewalsNeeded > 0) {
    warnings.push(warning('BLOCK_RENEWALS_NEEDED', `You could spend up to ${formatRupees(potentialSpend)} over ${days} days but one block holds at most ${formatRupees(BLOCK_LIMIT)}, so expect to renew blocks about ${renewalsNeeded} ${renewalsNeeded === 1 ? 'time' : 'times'}. A refund does not give a block back.`));
  }

  const rules = [];
  if (backed.length) rules.push({ field: 'merchants', enforcedBy: 'rail+layer', merchantIds: backed, text: 'Only these shops can be paid. The bank holds the block and this app checks again.' });
  if (unbacked.length) rules.push({ field: 'merchants', enforcedBy: 'layer', merchantIds: unbacked, text: 'Only this app limits these shops: the bank holds no block for them.' });
  if (mandate.categories) rules.push({ field: 'categories', enforcedBy: 'layer', text: 'Kinds of purchase are checked by this app only; the bank does not see them.' });
  if (mandate.perOrderCap !== null) rules.push({ field: 'perOrderCap', enforcedBy: 'layer', text: 'The per-order limit is checked by this app only.' });
  if (mandate.periodCap) rules.push({ field: 'periodCap', enforcedBy: 'layer', text: 'The daily, weekly or monthly limit is checked by this app only.' });
  if (mandate.blockedWeekdays.length) rules.push({ field: 'blockedWeekdays', enforcedBy: 'layer', text: 'Blocked days are checked by this app only.' });
  if (mandate.askAbove !== null) rules.push({ field: 'askAbove', enforcedBy: 'layer', text: 'Asking you above an amount is done by this app only.' });
  if (mandate.autoApproveIrreversible) rules.push({ field: 'autoApproveIrreversible', enforcedBy: 'layer', text: 'Permission for purchases that cannot be undone is held by this app only.' });
  rules.push({
    field: 'duration',
    enforcedBy: blocks.length ? 'rail+layer' : 'layer',
    text: blocks.length ? 'The block expires with the mandate, and this app checks the dates too.' : 'The end date is checked by this app only: no block exists to expire.',
  });

  return { days, potentialSpend, blockSize, blocks, unbacked, renewalsNeeded, warnings, rules, bank: { maxActiveBlocks: room } };
}
