// Mandate validation: a raw mandate (from a form) in, a checked mandate out.
// See docs/SPEC.md section 4. Nothing here guesses: a value is accepted as
// written or reported as an error, and every error names the field it is about.

import { WEEKDAYS, addDays, parseDate } from './time.js';
import { MAX_AMOUNT, formatRupees, isMandateAmount } from './money.js';
import { getCategory, getMerchant, has } from './catalogue.js';

const PERIODS = ['day', 'week', 'month'];
export const DEFAULT_DURATION_DAYS = 30;
export const MAX_DURATION_DAYS = 90;

const AMOUNT_RULE = `a whole number of rupees from ₹1 to ${formatRupees(MAX_AMOUNT)}`;

function issue(code, field, message) {
  return { code, field, message };
}

function dedupe(list) {
  return [...new Set(list)];
}

/**
 * @param {object} raw the form values; missing fields count as null, unknown fields are ignored
 * @param {{today: string, catalogue: object}} context `today` is an IST date, 'YYYY-MM-DD'
 * @returns {{ok: boolean, mandate: object|null, errors: object[], warnings: object[]}}
 */
export function normalizeMandate(raw, { today, catalogue }) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('a raw mandate must be an object');
  }
  parseDate(today); // throws for a malformed or impossible date: a programming error, not user input
  const errors = [];
  const warnings = [];
  const read = (key) => (has(raw, key) && raw[key] !== undefined ? raw[key] : null);

  // Merchants -----------------------------------------------------------------
  let merchants = null;
  const rawMerchants = read('merchants');
  if (rawMerchants !== null) {
    if (!Array.isArray(rawMerchants) || rawMerchants.some((id) => typeof id !== 'string')) {
      errors.push(issue('BAD_MERCHANTS', 'merchants', 'Shops must be a list of shop ids.'));
    } else {
      const ids = dedupe(rawMerchants);
      for (const id of ids) {
        const merchant = getMerchant(catalogue, id);
        if (!merchant) errors.push(issue('UNKNOWN_MERCHANT', 'merchants', `"${id}" is not a shop in the catalogue.`));
        else if (merchant.verified !== true) errors.push(issue('MERCHANT_UNVERIFIED', 'merchants', `${merchant.name} is not a verified shop, so it cannot be added.`));
      }
      merchants = ids.length ? ids : null;
    }
  }

  // Categories ----------------------------------------------------------------
  let categories = null;
  const rawCategories = read('categories');
  if (rawCategories !== null) {
    if (!Array.isArray(rawCategories) || rawCategories.some((id) => typeof id !== 'string')) {
      errors.push(issue('BAD_CATEGORIES', 'categories', 'Categories must be a list of category ids.'));
    } else {
      const ids = dedupe(rawCategories);
      for (const id of ids) {
        if (!getCategory(catalogue, id)) errors.push(issue('UNKNOWN_CATEGORY', 'categories', `"${id}" is not a kind of purchase in the catalogue.`));
      }
      categories = ids.length ? ids : null;
    }
  }

  // Amounts -------------------------------------------------------------------
  const amount = (field, label) => {
    const value = read(field);
    if (value === null) return null;
    if (!isMandateAmount(value)) {
      errors.push(issue('BAD_AMOUNT', field, `${label} must be ${AMOUNT_RULE}.`));
      return null;
    }
    return value;
  };
  const perOrderCap = amount('perOrderCap', 'The per-order limit');
  const askAbove = amount('askAbove', 'The ask-me-above amount');

  let periodCap = null;
  const rawPeriodCap = read('periodCap');
  if (rawPeriodCap !== null) {
    if (typeof rawPeriodCap !== 'object' || Array.isArray(rawPeriodCap) || !PERIODS.includes(rawPeriodCap.period)) {
      errors.push(issue('BAD_PERIOD', 'periodCap', 'The spending limit needs a period of day, week or month.'));
    } else if (!isMandateAmount(rawPeriodCap.amount)) {
      errors.push(issue('BAD_AMOUNT', 'periodCap', `The spending limit must be ${AMOUNT_RULE}.`));
    } else {
      periodCap = { amount: rawPeriodCap.amount, period: rawPeriodCap.period };
    }
  }

  // Blocked days --------------------------------------------------------------
  let blockedWeekdays = [];
  const rawDays = read('blockedWeekdays');
  if (rawDays !== null) {
    if (!Array.isArray(rawDays) || rawDays.some((d) => !WEEKDAYS.includes(d))) {
      errors.push(issue('BAD_WEEKDAY', 'blockedWeekdays', 'Blocked days must come from mon, tue, wed, thu, fri, sat, sun.'));
    } else {
      const set = new Set(rawDays);
      if (set.size === WEEKDAYS.length) errors.push(issue('ALL_DAYS_BLOCKED', 'blockedWeekdays', 'Blocking every day of the week would stop the agent completely. Use pause instead.'));
      else blockedWeekdays = WEEKDAYS.filter((d) => set.has(d));
    }
  }

  // Irreversible purchases ----------------------------------------------------
  let autoApproveIrreversible = false;
  const rawFlag = read('autoApproveIrreversible');
  if (rawFlag !== null) {
    if (typeof rawFlag !== 'boolean') errors.push(issue('BAD_FLAG', 'autoApproveIrreversible', 'This setting must be on or off.'));
    else autoApproveIrreversible = rawFlag;
  }

  // Duration ------------------------------------------------------------------
  let durationDays = DEFAULT_DURATION_DAYS;
  const rawDuration = read('durationDays');
  if (rawDuration === null) {
    warnings.push(issue('DURATION_DEFAULTED', 'durationDays', `No duration was given, so the mandate lasts ${DEFAULT_DURATION_DAYS} days.`));
  } else if (!Number.isInteger(rawDuration) || rawDuration < 1) {
    errors.push(issue('BAD_DURATION', 'durationDays', 'The duration must be a whole number of days, 1 or more.'));
  } else if (rawDuration > MAX_DURATION_DAYS) {
    durationDays = MAX_DURATION_DAYS;
    warnings.push(issue('DURATION_CLAMPED', 'durationDays', `A payment block lasts at most ${MAX_DURATION_DAYS} days, so the mandate was shortened to ${MAX_DURATION_DAYS}.`));
  } else {
    durationDays = rawDuration;
  }

  if (errors.length) return { ok: false, mandate: null, errors, warnings: [] };

  // Warnings that need the whole mandate --------------------------------------
  if (perOrderCap === null && periodCap === null) {
    warnings.push(issue('NO_SPEND_CAP', null, 'There is no per-order or period limit. Only the payment block (at most ₹10,000 per shop) would limit spending.'));
  }
  if (perOrderCap !== null && periodCap !== null && perOrderCap > periodCap.amount) {
    warnings.push(issue('ORDER_CAP_ABOVE_PERIOD_CAP', 'perOrderCap', 'The per-order limit is higher than the period limit, so the period limit will always bind first.'));
  }
  if (askAbove !== null && perOrderCap !== null && askAbove >= perOrderCap) {
    warnings.push(issue('ASK_ABOVE_NOT_BELOW_CAP', 'askAbove', 'Ask-me-above is not below the per-order limit, so it will never trigger.'));
  }
  if (merchants && categories) {
    const outside = merchants.filter((id) => !categories.includes(getMerchant(catalogue, id).category));
    if (outside.length) {
      const names = outside.map((id) => getMerchant(catalogue, id).name).join(', ');
      warnings.push(issue('MERCHANT_OUTSIDE_CATEGORIES', 'merchants', `${names} sells a kind of purchase you did not allow, so its orders would always be blocked.`));
    }
  }

  return {
    ok: true,
    errors: [],
    warnings,
    mandate: {
      merchants,
      categories,
      perOrderCap,
      periodCap,
      blockedWeekdays,
      askAbove,
      autoApproveIrreversible,
      durationDays,
      validFrom: today,
      validUntil: addDays(today, durationDays - 1),
    },
  };
}
