// Money is whole rupees, held as integers. Paise are not modelled in v1.

export const MAX_AMOUNT = 1_000_000;

/** An amount a person may put in a mandate: a whole number from 1 to 1,000,000. */
export function isMandateAmount(n) {
  return Number.isInteger(n) && n >= 1 && n <= MAX_AMOUNT;
}

/** An amount an agent may propose: a positive whole number that is exact in a double. */
export function isPositiveSafeInt(n) {
  return Number.isSafeInteger(n) && n > 0;
}

/**
 * ₹1,200 and ₹1,00,000: the last three digits, then groups of two (Indian
 * grouping). Written by hand so that Node, browsers and the Worker print the
 * same text whatever locale data they ship with.
 */
export function formatRupees(n) {
  if (!Number.isSafeInteger(n)) throw new TypeError(`not a whole rupee amount: ${String(n)}`);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n));
  if (digits.length <= 3) return `${sign}₹${digits}`;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}₹${head},${digits.slice(-3)}`;
}
