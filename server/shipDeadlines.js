/** July 2, 2026 at 10:00 AM Eastern Daylight Time. */
export const SHIP_FIRST_DEADLINE_AT = new Date("2026-07-02T10:00:00-04:00");

/** July 15, 2026 at 10:00 AM Eastern Daylight Time — shipping closes. */
export const SHIP_CLOSE_AT = new Date("2026-07-15T10:00:00-04:00");

export function isShippingClosed(now = Date.now()) {
  return now >= SHIP_CLOSE_AT.getTime();
}
