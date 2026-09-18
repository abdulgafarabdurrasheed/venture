import crypto from "crypto";
import { isProduction } from "./security.js";

export const PROD_AUTH_USER_COOKIE = "offtrack.auth_user";
export const PROD_PLATFORM_UNLOCK_COOKIE = "offtrack.platform_unlock";

const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === "production";

const PROD_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: IS_PROD,
  maxAge: COOKIE_MAX_AGE_MS,
  path: "/",
};

const PROD_COOKIE_CLEAR_OPTIONS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: IS_PROD,
};

function cookieSecret() {
  return process.env.SESSION_SECRET || "dev-insecure-session-secret-change-me";
}

function signPayload(payload) {
  const signature = crypto.createHmac("sha256", cookieSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

function verifySignedCookie(value) {
  const [payload, signature] = String(value || "").split(".");
  if (!payload || !signature) return null;

  const expectedSignature = crypto.createHmac("sha256", cookieSecret()).update(payload).digest("hex");
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  return payload;
}

export function setProductionAuthUserCookie(res, userId) {
  if (!isProduction() || !userId) return;
  res.cookie(PROD_AUTH_USER_COOKIE, signPayload(String(userId)), PROD_COOKIE_OPTIONS);
}

export function setProductionPlatformUnlockCookie(res) {
  if (!isProduction()) return;
  res.cookie(PROD_PLATFORM_UNLOCK_COOKIE, signPayload("1"), PROD_COOKIE_OPTIONS);
}

export function clearProductionAuthCookies(res) {
  if (!isProduction()) return;
  res.clearCookie(PROD_AUTH_USER_COOKIE, PROD_COOKIE_CLEAR_OPTIONS);
  res.clearCookie(PROD_PLATFORM_UNLOCK_COOKIE, PROD_COOKIE_CLEAR_OPTIONS);
}

export function readProductionAuthUserId(req) {
  if (!isProduction()) return null;
  const payload = verifySignedCookie(req.cookies?.[PROD_AUTH_USER_COOKIE]);
  if (!payload || !/^\d+$/.test(payload)) return null;
  return payload;
}

export function hasProductionPlatformUnlockCookie(req) {
  if (!isProduction()) return false;
  return verifySignedCookie(req.cookies?.[PROD_PLATFORM_UNLOCK_COOKIE]) === "1";
}

/** Rehydrate express-session from signed prod cookies after deploys or MemoryStore loss. */
export function restoreProductionSessionFromCookies(req) {
  if (!isProduction() || !req.session) return;

  if (!req.session.userId) {
    const userId = readProductionAuthUserId(req);
    if (userId) {
      req.session.userId = userId;
    }
  }

  if (!req.session.platformUnlocked && hasProductionPlatformUnlockCookie(req)) {
    req.session.platformUnlocked = true;
  }
}
