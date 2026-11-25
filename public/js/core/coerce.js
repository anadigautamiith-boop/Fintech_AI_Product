// Turn the mandate reader's answer into form fields.
//
// The reader is a model and its answer is untrusted. This code reads only the
// keys it knows, maps shop and category names to catalogue ids, and puts
// anything it cannot map into `unresolved` instead of guessing or quietly
// dropping it. It never fills in a value the text did not state.
// docs/SPEC.md section 11.

import { WEEKDAYS } from './time.js';
import { matchCategoryName, matchMerchantName, has } from './catalogue.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const squash = (text) => String(text).trim().toLowerCase().replace(/\s+/g, ' ');

const PERIOD_WORDS = {
  day: ['day', 'daily', 'per day', 'a day', 'each day', 'every day', 'everyday'],
  week: ['week', 'weekly', 'per week', 'a week', 'each week', 'every week', 'wk', 'per wk'],
  month: ['month', 'monthly', 'per month', 'a month', 'each month', 'every month'],
};

const DAY_WORDS = {
  mon: ['mon', 'monday', 'mondays'],
  tue: ['tue', 'tues', 'tuesday', 'tuesdays'],
  wed: ['wed', 'weds', 'wednesday', 'wednesdays'],
  thu: ['thu', 'thur', 'thurs', 'thursday', 'thursdays'],
  fri: ['fri', 'friday', 'fridays'],
  sat: ['sat', 'saturday', 'saturdays'],
  sun: ['sun', 'sunday', 'sundays'],
};
const DAY_GROUPS = {
  weekend: ['sat', 'sun'],
  weekends: ['sat', 'sun'],
  weekday: ['mon', 'tue', 'wed', 'thu', 'fri'],
  weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
};

function toList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** A whole-rupee amount from a number or from text such as "₹1,200", "2k", "Rs. 1.5k". */
function parseAmount(value) {
  if (value === undefined || value === null) return { value: null };
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 ? { value } : { bad: true };
  if (typeof value !== 'string') return { bad: true };
  const m = /^\s*(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*$/i.exec(value);
  if (!m) return { bad: true };
  const n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
  const whole = Math.round(n);
  return Math.abs(n - whole) < 1e-6 && whole >= 1 ? { value: whole } : { bad: true };
}

function parseWord(table, value) {
  if (typeof value !== 'string') return null;
  const wanted = squash(value);
  for (const [key, words] of Object.entries(table)) if (words.includes(wanted)) return key;
  return null;
}

/**
 * @param {*} modelOutput what the model returned, already parsed from JSON
 * @param {object} catalogue
 * @returns {{fields: object, unresolved: {field: string, value: string}[], notes: string[]}}
 */
export function coerceParsed(modelOutput, catalogue) {
  const fields = {
    merchants: null,
    categories: null,
    perOrderCap: null,
    periodCap: null,
    blockedWeekdays: [],
    askAbove: null,
    autoApproveIrreversible: false,
    durationDays: null,
  };
  const unresolved = [];
  const notes = [];
  if (!isObject(modelOutput)) {
    unresolved.push({ field: '*', value: 'model output was not an object' });
    return { fields, unresolved, notes };
  }
  const read = (key) => (has(modelOutput, key) ? modelOutput[key] : undefined);

  const mapNames = (field, match) => {
    const ids = [];
    for (const entry of toList(read(field))) {
      const id = typeof entry === 'string' ? match(catalogue, entry) : null;
      if (id === null) unresolved.push({ field, value: String(entry) });
      else if (!ids.includes(id)) ids.push(id);
    }
    return ids.length ? ids : null;
  };
  fields.merchants = mapNames('merchants', matchMerchantName);
  fields.categories = mapNames('categories', matchCategoryName);

  const amountField = (field, raw) => {
    const parsed = parseAmount(raw);
    if (parsed.bad) unresolved.push({ field, value: String(raw) });
    return parsed.bad ? null : parsed.value;
  };
  fields.perOrderCap = amountField('perOrderCap', read('perOrderCap'));
  fields.askAbove = amountField('askAbove', read('askAbove'));

  const periodCap = read('periodCap');
  if (periodCap !== undefined && periodCap !== null) {
    if (!isObject(periodCap)) {
      unresolved.push({ field: 'periodCap', value: String(periodCap) });
    } else {
      const rawAmount = has(periodCap, 'amount') ? periodCap.amount : null;
      const rawPeriod = has(periodCap, 'period') ? periodCap.period : null;
      const amount = parseAmount(rawAmount);
      const period = parseWord(PERIOD_WORDS, rawPeriod);
      if (amount.bad) unresolved.push({ field: 'periodCap', value: String(rawAmount) });
      if (rawPeriod !== null && period === null) unresolved.push({ field: 'periodCap', value: String(rawPeriod) });
      if (!amount.bad && rawPeriod !== null && period !== null) {
        if (amount.value === null) unresolved.push({ field: 'periodCap', value: 'no amount given' });
        else fields.periodCap = { amount: amount.value, period };
      } else if (!amount.bad && rawPeriod === null && amount.value !== null) {
        unresolved.push({ field: 'periodCap', value: 'no period given' });
      }
    }
  }

  const days = new Set();
  for (const entry of toList(read('blockedWeekdays'))) {
    const word = typeof entry === 'string' ? squash(entry) : null;
    const group = word && has(DAY_GROUPS, word) ? DAY_GROUPS[word] : null;
    const day = group ? null : parseWord(DAY_WORDS, entry);
    if (group) group.forEach((d) => days.add(d));
    else if (day) days.add(day);
    else unresolved.push({ field: 'blockedWeekdays', value: String(entry) });
  }
  fields.blockedWeekdays = WEEKDAYS.filter((d) => days.has(d));

  const flag = read('autoApproveIrreversible');
  if (flag === true) fields.autoApproveIrreversible = true;
  else if (flag !== undefined && flag !== null && flag !== false) unresolved.push({ field: 'autoApproveIrreversible', value: String(flag) });

  const duration = read('durationDays');
  if (duration !== undefined && duration !== null) {
    const n = typeof duration === 'string' && /^\s*\d+\s*$/.test(duration) ? Number(duration) : duration;
    if (Number.isInteger(n) && n >= 1) fields.durationDays = n;
    else unresolved.push({ field: 'durationDays', value: String(duration) });
  }

  for (const note of toList(read('notes'))) {
    if (typeof note === 'string' && note.trim() && notes.length < 5) notes.push(note.trim().slice(0, 200));
  }
  return { fields, unresolved, notes };
}
