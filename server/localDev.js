import { isProduction } from "./security.js";
import { buildSessionProfileSnapshot, upsertDevUser } from "./users.js";
import { getDefaultDevEmail } from "./env.js";

export function isLocalhostRequest(req) {
  const hostHeader = (req.get("X-Forwarded-Host") || req.get("Host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const hostname = hostHeader.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function isLocalDevRequest(req) {
  return !isProduction() && isLocalhostRequest(req);
}

function localDevIdentity() {
  const fromEnv = process.env.DEV_USER_EMAIL?.trim();
  if (fromEnv) {
    return { email: fromEnv.toLowerCase(), name: "Local Dev" };
  }

  return { email: getDefaultDevEmail().toLowerCase(), name: "Dev User" };
}

/** Localhost dev: auto-create a session so the platform works without OAuth or login UI. */
export async function ensureLocalDevSession(req) {
  if (!isLocalDevRequest(req) || req.session?.userId) {
    return;
  }

  const { email, name } = localDevIdentity();
  const user = await upsertDevUser({ email, name });
  req.session.userId = user.id;
  req.session.hackclubSub = user.hackclub_sub;
  req.session.profileSnapshot = buildSessionProfileSnapshot(
    { email, name, sub: user.hackclub_sub },
    { userRow: user }
  );
  req.session.platformUnlocked = true;
}
