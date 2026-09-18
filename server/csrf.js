import csrf from "csurf";

const isProd = process.env.NODE_ENV === "production";

export const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
  },
});

/** Skip CSRF for machine-to-machine sync using a shared secret header. */
export function shouldSkipCsrf(req) {
  const syncSecret = process.env.AIRTABLE_SYNC_SECRET;
  if (!syncSecret) return false;
  return req.get("x-sync-secret") === syncSecret;
}

export function csrfProtectionUnlessSyncSecret(req, res, next) {
  if (shouldSkipCsrf(req)) {
    next();
    return;
  }
  csrfProtection(req, res, next);
}

export function handleCsrfError(err, req, res, next) {
  if (err?.code !== "EBADCSRFTOKEN") {
    next(err);
    return;
  }

  if (req.path.startsWith("/api")) {
    res.status(403).json({ error: "Invalid or missing CSRF token." });
    return;
  }

  res.status(403).send("Invalid or missing CSRF token.");
}
