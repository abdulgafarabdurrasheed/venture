export const COINS_PER_APPROVED_HOUR = 20;

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
