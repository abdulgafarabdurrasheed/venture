import crypto from "crypto";
import express from "express";
import { hasProductionPlatformUnlockCookie, setProductionPlatformUnlockCookie } from "./authCookies.js";
import { isLocalDevRequest } from "./localDev.js";
import { isProduction } from "./security.js";
import { authRateLimiter } from "./rateLimit.js";
import { createJournalingRouter } from "./journalingAccess.js";

const PLATFORM_PASSWORD = process.env.PLATFORM_PASSWORD?.trim();
const UNLOCK_WINDOW_MS = 15 * 60 * 1000;
const UNLOCK_MAX_ATTEMPTS = 8;
const unlockAttempts = new Map();

export function isPlatformPasswordConfigured() {
  return Boolean(PLATFORM_PASSWORD);
}

export function assertPlatformPasswordConfiguredInProduction() {
  // Platform is open; password gate is not required in production.
}

export function shouldEnforcePlatformPassword(_req) {
  return false;
}

export function isPlatformUnlocked(req) {
  if (!shouldEnforcePlatformPassword(req)) return true;
  if (req.session?.platformUnlocked) return true;
  if (isProduction() && hasProductionPlatformUnlockCookie(req)) {
    if (req.session) {
      req.session.platformUnlocked = true;
    }
    return true;
  }
  return false;
}

const PUBLIC_API_PATHS = new Set([
  "/health",
  "/db/health",
  "/csrf-token",
  "/auth/me",
  "/auth/hackclub/login",
  "/auth/hackclub/callback",
  "/auth/hackatime/login",
  "/auth/hackatime/callback",
  "/auth/dev/signup",
  "/auth/mode",
]);

export function isPublicApiPath(pathname) {
  const pathOnly = pathname.split("?")[0];
  return (
    PUBLIC_API_PATHS.has(pathOnly) ||
    pathOnly === "/platform/journaling" ||
    pathOnly.startsWith("/platform/journaling/")
  );
}

export function requirePlatformAccess(req, res, next) {
  if (!shouldEnforcePlatformPassword(req) || isPlatformUnlocked(req)) {
    next();
    return;
  }

  res.status(403).json({ error: "Platform access password required.", code: "platform_locked" });
}

function clientKey(req) {
  const forwarded = req.get("X-Forwarded-For");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

function isUnlockRateLimited(req) {
  const key = clientKey(req);
  const now = Date.now();
  const entry = unlockAttempts.get(key);

  if (!entry || now - entry.windowStart > UNLOCK_WINDOW_MS) {
    unlockAttempts.set(key, { windowStart: now, count: 0 });
    return false;
  }

  return entry.count >= UNLOCK_MAX_ATTEMPTS;
}

function recordFailedUnlockAttempt(req) {
  const key = clientKey(req);
  const now = Date.now();
  const entry = unlockAttempts.get(key);

  if (!entry || now - entry.windowStart > UNLOCK_WINDOW_MS) {
    unlockAttempts.set(key, { windowStart: now, count: 1 });
    return;
  }

  entry.count += 1;
}

function passwordsMatch(provided, expected) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    crypto.timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

export function createPlatformRouter() {
  const router = express.Router();

  router.use(authRateLimiter);
  router.use("/journaling", createJournalingRouter());

  router.get("/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      required: shouldEnforcePlatformPassword(req),
      unlocked: isPlatformUnlocked(req),
      localDev: isLocalDevRequest(req),
    });
  });

  router.post("/unlock", (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    if (isUnlockRateLimited(req)) {
      res.status(429).json({ error: "Too many attempts. Try again later." });
      return;
    }

    if (!isPlatformPasswordConfigured()) {
      req.session.platformUnlocked = true;
      setProductionPlatformUnlockCookie(res);
      res.json({ ok: true, unlocked: true });
      return;
    }

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password || !passwordsMatch(password, PLATFORM_PASSWORD)) {
      recordFailedUnlockAttempt(req);
      res.status(401).json({ error: "Incorrect password." });
      return;
    }

    req.session.platformUnlocked = true;
    setProductionPlatformUnlockCookie(res);
    res.json({ ok: true, unlocked: true });
  });

  return router;
}
