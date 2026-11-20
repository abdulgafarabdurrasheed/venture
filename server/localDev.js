import { isProduction } from "./security.js";
import { buildSessionProfileSnapshot, upsertDevUser } from "./users.js";
import { getDefaultDevEmail } from "./env.js";
import { isHackClubAuthEnabled } from "./hackclubAuth.js";

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

export function isLocalDevAuthEnabled(req) {
  if (!isLocalDevRequest(req)) return false;
  if (process.env.LOCAL_DEV_AUTH?.trim().toLowerCase() === "true") return true;
  return !isHackClubAuthEnabled();
}

function localDevIdentity() {
  const fromEnv = process.env.DEV_USER_EMAIL?.trim();
  if (fromEnv) {
    return { email: fromEnv.toLowerCase(), name: "Local Dev" };
  }

  return { email: getDefaultDevEmail().toLowerCase(), name: "Dev User" };
}

/** Localhost fallback: create a fake user only when local dev auth is selected. */
export async function ensureLocalDevSession(req) {
  if (!isLocalDevAuthEnabled(req) || req.session?.userId) {
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
