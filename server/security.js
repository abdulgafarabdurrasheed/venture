/** @returns {boolean} */
export function isProduction() {
  return process.env.NODE_ENV === "production";
}

/**
 * Client-safe error text. In production, never forward raw Error messages for 500s
 * (they may contain SQL, paths, or token/API details).
 */
export function clientErrorMessage(error, fallback) {
  if (!isProduction()) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    return message.trim() || fallback;
  }
  return fallback;
}

/** Minimal DB health for load balancers — no timestamps or config hints. */
export function publicDatabaseHealthPayload(health) {
  return { ok: Boolean(health?.ok) };
}
