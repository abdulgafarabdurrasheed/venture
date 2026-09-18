/** 1 approved hour = 20 coins at $8/h → 2.5 coins per USD. */
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

export function coinsToUsd(coins) {
  const amount = Number(coins);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Number((amount / COINS_PER_USD).toFixed(2));
}
