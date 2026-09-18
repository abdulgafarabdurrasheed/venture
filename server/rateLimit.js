import rateLimit from "express-rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/** Applied to all requests so expensive handlers (filesystem, auth checks) are rate-limited. */
export const globalRateLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Stricter limit for API routes. */
export const apiRateLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again later." },
});

/** OAuth and session auth endpoints. */
export const authRateLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts. Try again later." },
});

/** Production SPA fallback and static assets. */
export const spaRateLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
