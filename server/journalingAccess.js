import crypto from "crypto";
import express from "express";

import { isJournalSharingConfigured, isValidJournalShareToken } from "./journalShare.js";
import { getPublicJournalingProject, listPublicJournalingProjects } from "./projects.js";
import { authRateLimiter } from "./rateLimit.js";

const JOURNALING_PASSWORD = process.env.JOURNALING_PW?.trim() || "";
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 8;
const failedAttempts = new Map();

function clientKey(req) {
  const forwarded = req.get("X-Forwarded-For");
  const ip = forwarded ? forwarded.split(",")[0].trim() : req.ip || "unknown";
  return `${ip}:${String(req.params.id || "")}`;
}

function isRateLimited(req) {
  const now = Date.now();
  const entry = failedAttempts.get(clientKey(req));
  return Boolean(entry && now - entry.windowStart <= ATTEMPT_WINDOW_MS && entry.count >= MAX_FAILED_ATTEMPTS);
}

function recordFailure(req) {
  const key = clientKey(req);
  const now = Date.now();
  const entry = failedAttempts.get(key);
  if (!entry || now - entry.windowStart > ATTEMPT_WINDOW_MS) {
    failedAttempts.set(key, { windowStart: now, count: 1 });
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

function requireJournalingAccess(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  if (!isJournalSharingConfigured()) {
    res.status(503).json({ error: "Journaling access is not configured." });
    return;
  }
  if (!isValidJournalShareToken(req.params.id, req.params.token)) {
    res.status(404).json({ error: "Journal project not found." });
    return;
  }
  const unlockedToken = req.session?.unlockedJournalProjects?.[String(req.params.id)];
  if (unlockedToken !== req.params.token) {
    res.status(401).json({ error: "Journaling password required.", code: "journaling_locked" });
    return;
  }
  next();
}

function requireGeneralJournalingAccess(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  if (!isJournalSharingConfigured()) {
    res.status(503).json({ error: "Journaling access is not configured." });
    return;
  }
  if (!req.session?.generalJournalingUnlocked) {
    res.status(401).json({ error: "Journaling password required.", code: "journaling_locked" });
    return;
  }
  next();
}

export function createJournalingRouter() {
  const router = express.Router();

  router.get("/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      configured: isJournalSharingConfigured(),
      unlocked: Boolean(isJournalSharingConfigured() && req.session?.generalJournalingUnlocked),
    });
  });

  router.post("/unlock", authRateLimiter, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isJournalSharingConfigured()) {
      res.status(503).json({ error: "Journaling access is not configured." });
      return;
    }
    if (isRateLimited(req)) {
      res.status(429).json({ error: "Too many attempts. Try again later." });
      return;
    }

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password || !passwordsMatch(password, JOURNALING_PASSWORD)) {
      recordFailure(req);
      res.status(401).json({ error: "Incorrect password." });
      return;
    }

    failedAttempts.delete(clientKey(req));
    req.session.generalJournalingUnlocked = true;
    res.json({ ok: true, unlocked: true });
  });

  router.get("/projects", requireGeneralJournalingAccess, async (_req, res) => {
    try {
      res.json({ projects: await listPublicJournalingProjects() });
    } catch (error) {
      console.error("[journaling] Failed to load journal projects:", error);
      res.status(500).json({ error: "Failed to load journal projects." });
    }
  });

  router.get("/projects/:id/:token/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isJournalSharingConfigured()) {
      res.status(503).json({ error: "Journaling access is not configured." });
      return;
    }
    if (!isValidJournalShareToken(req.params.id, req.params.token)) {
      res.status(404).json({ error: "Journal project not found." });
      return;
    }
    res.json({
      configured: true,
      unlocked: req.session?.unlockedJournalProjects?.[String(req.params.id)] === req.params.token,
    });
  });

  router.post("/projects/:id/:token/unlock", authRateLimiter, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isJournalSharingConfigured()) {
      res.status(503).json({ error: "Journaling access is not configured." });
      return;
    }
    if (!isValidJournalShareToken(req.params.id, req.params.token)) {
      res.status(404).json({ error: "Journal project not found." });
      return;
    }
    if (isRateLimited(req)) {
      res.status(429).json({ error: "Too many attempts. Try again later." });
      return;
    }

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password || !passwordsMatch(password, JOURNALING_PASSWORD)) {
      recordFailure(req);
      res.status(401).json({ error: "Incorrect password." });
      return;
    }

    failedAttempts.delete(clientKey(req));
    req.session.unlockedJournalProjects = {
      ...(req.session.unlockedJournalProjects || {}),
      [String(req.params.id)]: req.params.token,
    };
    res.json({ ok: true, unlocked: true });
  });

  router.get("/projects/:id/:token", requireJournalingAccess, async (req, res) => {
    try {
      const project = await getPublicJournalingProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Journal project not found." });
        return;
      }
      res.json(project);
    } catch (error) {
      console.error("[journaling] Failed to load public journal project:", error);
      res.status(500).json({ error: "Failed to load journal project." });
    }
  });

  return router;
}
