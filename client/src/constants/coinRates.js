export const COINS_PER_APPROVED_HOUR = 20;
export const USD_PER_APPROVED_HOUR = 8;
export const COINS_PER_USD = COINS_PER_APPROVED_HOUR / USD_PER_APPROVED_HOUR;
export const MIN_PURCHASE_USD = USD_PER_APPROVED_HOUR;

export function parsePurchaseUsd(usd) {
  const amount = Number(usd);
  if (!Number.isFinite(amount) || amount < MIN_PURCHASE_USD) return null;
  return Number(amount.toFixed(2));
}

export function usdToCoins(usd) {
  const amount = parsePurchaseUsd(usd);
  if (amount === null) return null;
  return Number((amount * COINS_PER_USD).toFixed(2));
}

export function formatCoins(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

export function formatUsd(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "$0.00";
  return `$${numeric.toFixed(2)}`;
}
