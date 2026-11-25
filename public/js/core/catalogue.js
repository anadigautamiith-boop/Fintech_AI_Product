// Lookups into the catalogue. Every lookup uses own properties only, so an id
// such as "__proto__" or "constructor" can never resolve to an inherited value.

export function has(obj, key) {
  return obj !== null && typeof obj === 'object' && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
}

export function getMerchant(catalogue, id) {
  return has(catalogue.merchants, id) ? catalogue.merchants[id] : null;
}

export function getCategory(catalogue, id) {
  return has(catalogue.categories, id) ? catalogue.categories[id] : null;
}

export function getItem(catalogue, sku) {
  return has(catalogue.items, sku) ? catalogue.items[sku] : null;
}

export function categoryOf(catalogue, merchantId) {
  const merchant = getMerchant(catalogue, merchantId);
  return merchant ? merchant.category : null;
}

const squash = (text) => String(text).trim().toLowerCase().replace(/\s+/g, ' ');
const compact = (text) => squash(text).replace(/[^\p{L}\p{N}]/gu, '');

function matchAlias(records, text) {
  if (typeof text !== 'string') return null;
  const wanted = compact(text);
  if (!wanted) return null;
  for (const [id, record] of Object.entries(records)) {
    const names = [id, record.name ?? '', record.label ?? '', ...(record.aliases ?? [])];
    if (names.some((n) => n && compact(n) === wanted)) return id;
  }
  return null;
}

/** 'Fresh Basket', ' QUICKMART ', 'quick-mart' match the same ids; anything else returns null. */
export function matchMerchantName(catalogue, text) {
  return matchAlias(catalogue.merchants, text);
}

export function matchCategoryName(catalogue, text) {
  return matchAlias(catalogue.categories, text);
}
