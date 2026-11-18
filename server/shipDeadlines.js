/** Shipping remains open until an explicit close date is set. */
export const SHIP_CLOSE_AT = null;

export function isShippingClosed(now = Date.now()) {
  return SHIP_CLOSE_AT !== null && now >= SHIP_CLOSE_AT.getTime();
}
