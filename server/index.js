import "./env.js";
import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";
import express from "express";
import fs from "fs/promises";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import { createAuthRouter } from "./authRoutes.js";
import { restoreProductionSessionFromCookies } from "./authCookies.js";
import { createPlatformRouter, isPublicApiPath, requirePlatformAccess, assertPlatformPasswordConfiguredInProduction } from "./platformGate.js";
import { ensureLocalDevSession } from "./localDev.js";
import {
  assertDatabaseConfiguredInProduction,
  runDatabaseMigration,
} from "./migrate.js";
import { getAirtableSyncStatus, syncDatabaseToAirtable } from "./airtable.js";
import { getPeriodicAirtableSyncStatus, startPeriodicAirtableSync, syncAllUsersAndProjectsToAirtable } from "./airtablePeriodic.js";
import {
  getOrdersAirtableConfigStatus,
  hasAirtableOrdersConfig,
  warmOrdersFieldMap,
} from "./airtableOrders.js";
import { getYswsAirtableConfigStatus, hasAirtableYswsConfig, warmYswsFieldMap } from "./airtableYsws.js";
import { isHackClubAuthEnabled } from "./hackclubAuth.js";
import { isHackatimeOAuthConfigured } from "./hackatimeAuth.js";
import { getHackatimeStatusForUser, listHackatimeProjectsForUser, refreshUserHackatimeCache } from "./hackatimeService.js";
import { checkDatabaseConnection, getTestRows, hasDatabaseConfig } from "./db.js";
import { streamJournalMediaForReview } from "./journalMedia.js";
import { isHackClubCdnUrl } from "./cdnLinks.js";
import { clientErrorMessage, isProduction, publicDatabaseHealthPayload } from "./security.js";
import { adjustUserCoins, getAdminStats, getAuditLogForTarget } from "./adminStats.js";
import { csrfProtectionUnlessSyncSecret, handleCsrfError } from "./csrf.js";
import { apiRateLimiter, authRateLimiter, globalRateLimiter, spaRateLimiter } from "./rateLimit.js";
import {
  createShopItem,
  deleteShopItem,
  listShopItems,
  listShopOrders,
  markShopOrderFulfilled,
  purchaseShopItemForUser,
  rejectShopOrderWithRefund,
  reorderShopItems,
  setAllShopItemsActive,
  updateShopItem,
} from "./shopItems.js";
import {
  approveAdminReviewProject,
  blockAdminReviewProject,
  createProjectForUser,
  getProjectForUser,
  createJournalEntryForUser,
  updateJournalEntryForUser,
  deleteProjectForUser,
  deleteProjectBySuperadmin,
  getAdminReviewProject,
  getJournalEntriesCsv,
  listJournalEntriesForUserProject,
  listAdminReviewProjects,
  patchAdminReviewProjectFlags,
  InsufficientCoinsForReductionError,
  getParticipantPendingOrdersForReview,
  rejectParticipantOrderForReview,
  reduceAdminReviewProjectHours,
  listProjectsForUser,
  listHoursReductionWarningsForUser,
  acknowledgeHoursReductionWarnings,
  rejectAdminReviewProject,
  removeFromQueueAdminReviewProject,
  shipProjectForUser,
  syncAllProjectHoursForUser,
  updateProjectForUser,
} from "./projects.js";
import {
  canAccessFullAdmin,
  canAccessStaffReview,
  canPerformDestructiveAdmin,
  effectiveRole,
  getAdminUserById,
  getAdminUserWithProjects,
  getUserById,
  listAdminUsers,
} from "./users.js";
import { getUserDashboard } from "./userDashboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || (isProd ? 4173 : 3001);
const HOST = process.env.HOST || "0.0.0.0";

if (isProd) {
  app.set("trust proxy", 1);
}
const AIRTABLE_SYNC_SECRET = process.env.AIRTABLE_SYNC_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const LOCAL_UPLOADS_DIR = path.join(__dirname, "uploads");

if (isProd && !SESSION_SECRET) {
  throw new Error("[session] SESSION_SECRET must be set in production.");
}

assertPlatformPasswordConfiguredInProduction();
assertDatabaseConfiguredInProduction();

app.use(globalRateLimiter);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "0");
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    name: "offtrack.sid",
    secret: SESSION_SECRET || "dev-insecure-session-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(csrfProtectionUnlessSyncSecret);

app.use((req, _res, next) => {
  restoreProductionSessionFromCookies(req);
  next();
});

app.use(async (req, res, next) => {
  try {
    await ensureLocalDevSession(req);
  } catch (error) {
    console.error("[localDev] Failed to ensure dev session:", error);
  }
  next();
});

const authRouter = createAuthRouter({ rateLimiter: authRateLimiter });
const platformRouter = createPlatformRouter();

app.use("/api/platform", platformRouter);

app.use("/api", apiRateLimiter);
app.use("/api", (req, res, next) => {
  if (isPublicApiPath(req.path)) {
    next();
    return;
  }
  requirePlatformAccess(req, res, next);
});

app.use("/api/auth", authRouter);

async function requireFullAdmin(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    const row = await getUserById(userId);
    if (!canAccessFullAdmin(effectiveRole(row))) {
      res.status(403).json({ error: "Admin only." });
      return;
    }
    next();
  } catch (error) {
    console.error("[admin] auth check failed:", error);
    res.status(500).json({ error: "Failed to verify admin access." });
  }
}

async function requireStaffReview(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    const row = await getUserById(userId);
    if (!canAccessStaffReview(effectiveRole(row))) {
      res.status(403).json({ error: "Staff review access only." });
      return;
    }
    next();
  } catch (error) {
    console.error("[review] auth check failed:", error);
    res.status(500).json({ error: "Failed to verify review access." });
  }
}

async function requireSuperAdmin(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    const row = await getUserById(userId);
    if (!canPerformDestructiveAdmin(effectiveRole(row))) {
      res.status(403).json({ error: "Superadmin only." });
      return;
    }
    next();
  } catch (error) {
    console.error("[superadmin] auth check failed:", error);
    res.status(500).json({ error: "Failed to verify superadmin access." });
  }
}

function requireUser(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  next();
}

app.use("/uploads", requirePlatformAccess, requireUser, express.static(LOCAL_UPLOADS_DIR));

function notFoundInProduction(req, res) {
  res.status(404).json({ error: "Not found." });
}

app.get("/api/health", (req, res) => {
  if (isProduction()) {
    res.json({ ok: true, service: "offtrack-api" });
    return;
  }

  res.json({
    ok: true,
    service: "offtrack-api",
    hackClubOAuth: isHackClubAuthEnabled(),
    hackatimeOAuth: isHackatimeOAuthConfigured(),
  });
});

app.get("/api/csrf-token", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ csrfToken: req.csrfToken() });
});

app.get("/api/db/health", async (req, res) => {
  if (isProduction()) {
    try {
      const health = await checkDatabaseConnection();
      res.status(health.ok ? 200 : 503).json(publicDatabaseHealthPayload(health));
    } catch (error) {
      console.error("Database health check failed:", error);
      res.status(503).json({ ok: false });
    }
    return;
  }

  try {
    const health = await checkDatabaseConnection();
    res.status(health.ok ? 200 : 503).json(health);
  } catch (error) {
    console.error("Database health check failed:", error);
    res.status(500).json({
      ok: false,
      configured: true,
      message: "Database health check failed.",
    });
  }
});

app.get("/api/test", async (req, res) => {
  if (isProduction()) {
    notFoundInProduction(req, res);
    return;
  }

  try {
    const rows = await getTestRows();
    res.json({ rows });
  } catch (error) {
    console.error("Failed to load test rows:", error);
    res.status(500).json({
      error: "Failed to load test rows.",
    });
  }
});

app.get("/api/shop/items", async (req, res) => {
  try {
    const items = await listShopItems();
    res.json({ items });
  } catch (error) {
    console.error("Failed to load shop items:", error);
    res.status(500).json({ error: "Failed to load shop items." });
  }
});

app.post("/api/shop/items/:id/buy", requireUser, async (req, res) => {
  try {
    const purchase = await purchaseShopItemForUser(req.session.userId, req.params.id, req.body);
    res.json({ purchase });
  } catch (error) {
    console.error("Failed to buy shop item:", error);
    res.status(400).json({ error: error.message || "Failed to buy shop item." });
  }
});

app.get("/api/user/dashboard", requireUser, async (req, res) => {
  try {
    const dashboard = await getUserDashboard(req.session.userId);
    res.json(dashboard);
  } catch (error) {
    console.error("Failed to load user dashboard:", error);
    res.status(500).json({ error: "Failed to load user dashboard." });
  }
});

app.get("/api/projects", requireUser, async (req, res) => {
  try {
    const userId = req.session.userId;
    try {
      if (isHackatimeOAuthConfigured()) {
        await refreshUserHackatimeCache(userId);
      } else {
        await syncAllProjectHoursForUser(userId);
      }
    } catch (error) {
      console.error("[projects] hours sync on list failed:", error?.message || error);
    }
    const projects = await listProjectsForUser(userId);
    const hoursReductionWarnings = await listHoursReductionWarningsForUser(userId);
    res.json({ projects, hackatimeAvailable: isHackatimeOAuthConfigured(), hoursReductionWarnings });
  } catch (error) {
    console.error("Failed to load projects:", error);
    res.status(500).json({ error: "Failed to load projects." });
  }
});

app.post("/api/projects/hours-warnings/acknowledge", requireUser, async (req, res) => {
  try {
    const feedbackIds = Array.isArray(req.body?.feedbackIds) ? req.body.feedbackIds : [];
    const result = await acknowledgeHoursReductionWarnings(req.session.userId, feedbackIds);
    res.json(result);
  } catch (error) {
    console.error("Failed to acknowledge hours reduction warnings:", error);
    res.status(400).json({ error: error.message || "Failed to acknowledge hours warning." });
  }
});

app.post("/api/projects", requireUser, async (req, res) => {
  try {
    const project = await createProjectForUser(req.session.userId, req.body);
    res.status(201).json({ project });
  } catch (error) {
    console.error("Failed to create project:", error);
    res.status(500).json({ error: error.message || "Failed to create project." });
  }
});

app.get("/api/projects/:id", requireUser, async (req, res) => {
  try {
    const project = await getProjectForUser(req.session.userId, req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json({ project, hackatimeAvailable: isHackatimeOAuthConfigured() });
  } catch (error) {
    console.error("Failed to load project:", error);
    res.status(500).json({ error: "Failed to load project." });
  }
});

app.get("/api/hackatime/status", requireUser, async (req, res) => {
  try {
    const status = await getHackatimeStatusForUser(req.session.userId);
    res.json(status);
  } catch (error) {
    console.error("Failed to load Hackatime status:", error);
    res.status(500).json({ error: "Failed to load Hackatime status." });
  }
});

app.post("/api/hackatime/refresh", requireUser, async (req, res) => {
  try {
    const refreshed = await refreshUserHackatimeCache(req.session.userId);
    const projects = await listProjectsForUser(req.session.userId);
    res.json({
      projects,
      hackatimeProjects: refreshed.projects,
      hackatimeTotalHours: refreshed.totalHours,
    });
  } catch (error) {
    console.error("Failed to refresh Hackatime hours:", error);
    res.status(500).json({ error: error.message || "Failed to refresh Hackatime hours." });
  }
});

app.get("/api/hackatime/projects", requireUser, async (req, res) => {
  try {
    const projects = await listHackatimeProjectsForUser(req.session.userId);
    res.json({ projects });
  } catch (error) {
    console.error("Failed to load Hackatime projects:", error);
    res.status(500).json({ error: error.message || "Failed to load Hackatime projects." });
  }
});

app.patch("/api/projects/:id", requireUser, async (req, res) => {
  try {
    const project = await updateProjectForUser(req.session.userId, req.params.id, req.body);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json({ project });
  } catch (error) {
    console.error("Failed to update project:", error);
    res.status(500).json({ error: error.message || "Failed to update project." });
  }
});

app.post("/api/projects/:id/ship", requireUser, async (req, res) => {
  try {
    const project = await shipProjectForUser(req.session.userId, req.params.id, {
      reshipUpdate: req.body?.reshipUpdate,
    });
    res.json({ project });
  } catch (error) {
    console.error("Failed to ship project:", error);
    res.status(400).json({ error: error.message || "Failed to ship project." });
  }
});

app.delete("/api/projects/:id", requireUser, async (req, res) => {
  try {
    const deleted = await deleteProjectForUser(req.session.userId, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete project:", error);
    res.status(500).json({ error: "Failed to delete project." });
  }
});

const CDN_API_KEY = process.env.CDN_API_KEY;
const CDN_UPLOAD_URL = "https://cdn.hackclub.com/api/v4/upload";
const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
]);
const ALLOWED_PROJECT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);
const PROJECT_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const PROJECT_IMAGE_MULTIPART_MAX_BYTES = PROJECT_IMAGE_MAX_BYTES + 64 * 1024;
const LOCAL_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const LOCAL_UPLOAD_MULTIPART_MAX_BYTES = LOCAL_UPLOAD_MAX_BYTES + 256 * 1024;
const MEDIA_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/ogg", "ogv"],
  ["video/quicktime", "mov"],
]);

function readRequestBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Upload too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function multipartBoundary(contentType) {
  return contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2] || "";
}

function extractMultipartFile(buffer, contentType) {
  const boundary = multipartBoundary(contentType);
  if (!boundary) return null;

  const delimiter = Buffer.from(`--${boundary}`);
  const headerBreak = Buffer.from("\r\n\r\n");
  let cursor = 0;

  while (cursor < buffer.length) {
    const boundaryStart = buffer.indexOf(delimiter, cursor);
    if (boundaryStart === -1) return null;

    let partStart = boundaryStart + delimiter.length;
    if (buffer[partStart] === 45 && buffer[partStart + 1] === 45) return null;
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) partStart += 2;

    const headerEnd = buffer.indexOf(headerBreak, partStart);
    if (headerEnd === -1) return null;

    const headers = buffer.subarray(partStart, headerEnd).toString("latin1");
    const dataStart = headerEnd + headerBreak.length;
    const nextBoundary = buffer.indexOf(Buffer.from(`\r\n--${boundary}`), dataStart);
    if (nextBoundary === -1) return null;

    if (/name="file"/i.test(headers) && /filename="/i.test(headers)) {
      const filename = headers.match(/filename="([^"]*)"/i)?.[1] || "project-image";
      return { filename, buffer: buffer.subarray(dataStart, nextBoundary) };
    }

    cursor = nextBoundary + 2;
  }

  return null;
}

async function saveLocalUpload({ req, body, contentType, fileType, subdir, maxBytes, tooLargeMessage }) {
  const file = extractMultipartFile(body, contentType);
  if (!file?.buffer?.length) {
    throw new Error("Could not read uploaded file.");
  }
  if (file.buffer.length > maxBytes) {
    throw new Error(tooLargeMessage);
  }

  const uploadDir = path.join(LOCAL_UPLOADS_DIR, subdir);
  await fs.mkdir(uploadDir, { recursive: true });

  const extension = MEDIA_EXTENSIONS.get(fileType) || "bin";
  const filename = `${Date.now()}-${randomUUID()}.${extension}`;
  await fs.writeFile(path.join(uploadDir, filename), file.buffer);

  return `${req.protocol}://${req.get("host")}/uploads/${subdir}/${filename}`;
}

app.post("/api/cdn/upload", requireUser, async (req, res) => {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.startsWith("multipart/form-data")) {
    return res.status(400).json({ error: "Expected multipart/form-data." });
  }

  const fileType = (req.headers["x-file-type"] || "").toLowerCase().trim();
  if (!fileType || !ALLOWED_MEDIA_TYPES.has(fileType)) {
    return res.status(400).json({ error: "Unsupported file type. Only images (JPEG, PNG, GIF, WebP, AVIF) and videos (MP4, WebM, OGG, MOV) are allowed." });
  }

  const uploadPurpose = (req.headers["x-upload-purpose"] || "").toLowerCase().trim();
  let bufferedBody = null;
  if (uploadPurpose === "project-image") {
    const fileSize = Number(req.headers["x-file-size"]);
    const contentLength = Number(req.headers["content-length"]);
    if (!ALLOWED_PROJECT_IMAGE_TYPES.has(fileType)) {
      return res.status(400).json({ error: "Project images must be JPEG, PNG, GIF, WebP, or AVIF." });
    }
    if (!Number.isFinite(fileSize) || fileSize > PROJECT_IMAGE_MAX_BYTES) {
      return res.status(400).json({ error: "Project image must be 3MB or smaller." });
    }
    if (Number.isFinite(contentLength) && contentLength > PROJECT_IMAGE_MULTIPART_MAX_BYTES) {
      return res.status(400).json({ error: "Project image upload is too large." });
    }

    try {
      bufferedBody = await readRequestBuffer(req, PROJECT_IMAGE_MULTIPART_MAX_BYTES);
    } catch {
      return res.status(400).json({ error: "Project image upload is too large." });
    }
  }

  if (!CDN_API_KEY) {
    if (!bufferedBody) {
      const contentLength = Number(req.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > LOCAL_UPLOAD_MULTIPART_MAX_BYTES) {
        return res.status(400).json({ error: "Upload is too large for local development storage." });
      }
      try {
        bufferedBody = await readRequestBuffer(req, LOCAL_UPLOAD_MULTIPART_MAX_BYTES);
      } catch {
        return res.status(400).json({ error: "Upload is too large for local development storage." });
      }
    }

    try {
      const isProjectImage = uploadPurpose === "project-image";
      const url = await saveLocalUpload({
        req,
        body: bufferedBody,
        contentType,
        fileType,
        subdir: isProjectImage ? "project-images" : "cdn",
        maxBytes: isProjectImage ? PROJECT_IMAGE_MAX_BYTES : LOCAL_UPLOAD_MAX_BYTES,
        tooLargeMessage: isProjectImage ? "Project image must be 3MB or smaller." : "Upload is too large for local development storage.",
      });
      return res.json({ url });
    } catch (error) {
      return res.status(400).json({ error: error.message || "Failed to save uploaded file." });
    }
  }

  try {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 20000);
    let cdnResponse;
    try {
      cdnResponse = await fetch(CDN_UPLOAD_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CDN_API_KEY}`,
          "Content-Type": contentType,
          ...(bufferedBody ? { "Content-Length": String(bufferedBody.length) } : {}),
        },
        body: bufferedBody || req,
        duplex: "half",
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await cdnResponse.json();
    if (!cdnResponse.ok) {
      return res.status(cdnResponse.status).json({ error: data?.error || "CDN upload failed." });
    }

    let uploadedUrl;
    try {
      const parsed = new URL(data.url || "");
      if (!isHackClubCdnUrl(parsed.href)) {
        throw new Error("Unexpected CDN response URL.");
      }
      uploadedUrl = parsed.href;
    } catch {
      return res.status(502).json({ error: "CDN returned an unexpected URL." });
    }

    res.json({ url: uploadedUrl });
  } catch (error) {
    console.error("CDN upload proxy error:", error);
    res.status(500).json({ error: "Failed to upload file." });
  }
});

app.get("/api/projects/:id/journal_entries", requireUser, async (req, res) => {
  try {
    const entries = await listJournalEntriesForUserProject(req.session.userId, req.params.id);
    res.json({ entries });
  } catch (error) {
    console.error("Failed to load journal entries:", error);
    res.status(500).json({ error: "Failed to load journal entries." });
  }
});

app.post("/api/projects/:id/journal_entries", requireUser, async (req, res) => {
  try {
    const result = await createJournalEntryForUser(req.session.userId, {
      ...req.body,
      projectId: req.params.id,
    });
    res.status(201).json(result);
  } catch (error) {
    console.error("Failed to create journal entry:", error);
    res.status(500).json({ error: error.message || "Failed to create journal entry." });
  }
});

app.patch("/api/projects/:id/journal_entries/:entryId", requireUser, async (req, res) => {
  try {
    const result = await updateJournalEntryForUser(
      req.session.userId,
      req.params.id,
      req.params.entryId,
      req.body
    );
    res.json(result);
  } catch (error) {
    const message = error.message || "Failed to update journal entry.";
    const status =
      message === "Project not found." || message === "Journal entry not found." ? 404 : 400;
    console.error("Failed to update journal entry:", error);
    res.status(status).json({ error: message });
  }
});

app.get("/api/admin/journals.csv", requireFullAdmin, async (req, res) => {
  try {
    const csv = await getJournalEntriesCsv();
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="offtrack-journal-entries-${today}.csv"`);
    res.send(`\uFEFF${csv}`);
  } catch (error) {
    console.error("Failed to export journal entries:", error);
    res.status(500).json({ error: "Failed to export journal entries." });
  }
});

app.get("/api/admin/review/media", requireStaffReview, async (req, res) => {
  try {
    await streamJournalMediaForReview(req, res);
  } catch (error) {
    console.error("Failed to proxy review media:", error);
    res.status(500).json({ error: "Failed to load media." });
  }
});

app.get("/api/admin/review/projects", requireStaffReview, async (req, res) => {
  try {
    const review = await listAdminReviewProjects({ shipSort: req.query.shipSort });
    res.json(review);
  } catch (error) {
    console.error("Failed to load review projects:", error);
    res.status(500).json({ error: "Failed to load review projects." });
  }
});

app.get("/api/admin/review/projects/:id", requireStaffReview, async (req, res) => {
  try {
    const reviewProject = await getAdminReviewProject(req.params.id);
    if (!reviewProject) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json(reviewProject);
  } catch (error) {
    console.error("Failed to load review project:", error);
    res.status(500).json({ error: "Failed to load review project." });
  }
});

app.post("/api/admin/review/projects/:id/approve", requireStaffReview, async (req, res) => {
  try {
    const result = await approveAdminReviewProject(req.session.userId, req.params.id, req.body);
    res.json(result);
  } catch (error) {
    console.error("Failed to approve review project:", error);
    res.status(400).json({ error: error.message || "Failed to approve project." });
  }
});

app.post("/api/admin/review/projects/:id/reject", requireStaffReview, async (req, res) => {
  try {
    const project = await rejectAdminReviewProject(req.session.userId, req.params.id, req.body);
    res.json({ project });
  } catch (error) {
    console.error("Failed to reject review project:", error);
    res.status(400).json({ error: error.message || "Failed to reject project." });
  }
});

app.post("/api/admin/review/projects/:id/remove-from-queue", requireStaffReview, async (req, res) => {
  try {
    const project = await removeFromQueueAdminReviewProject(req.session.userId, req.params.id, req.body);
    res.json({ project });
  } catch (error) {
    console.error("Failed to remove review project from queue:", error);
    res.status(400).json({ error: error.message || "Failed to remove project from queue." });
  }
});

app.post("/api/admin/review/projects/:id/block", requireStaffReview, async (req, res) => {
  try {
    const project = await blockAdminReviewProject(req.session.userId, req.params.id, req.body);
    res.json({ project });
  } catch (error) {
    console.error("Failed to block review project:", error);
    res.status(400).json({ error: error.message || "Failed to block project." });
  }
});

app.patch("/api/admin/review/projects/:id", requireStaffReview, async (req, res) => {
  try {
    const reviewProject = await patchAdminReviewProjectFlags(req.params.id, req.body);
    res.json(reviewProject);
  } catch (error) {
    console.error("Failed to update review project:", error);
    res.status(400).json({ error: error.message || "Failed to update project." });
  }
});

app.post("/api/admin/review/projects/:id/reduce-hours", requireStaffReview, async (req, res) => {
  try {
    const result = await reduceAdminReviewProjectHours(req.session.userId, req.params.id, req.body);
    res.json(result);
  } catch (error) {
    if (error instanceof InsufficientCoinsForReductionError) {
      res.status(409).json({
        error: error.message,
        code: "INSUFFICIENT_COINS_FOR_REDUCTION",
        ...error.payload,
      });
      return;
    }
    console.error("Failed to reduce review project hours:", error);
    res.status(400).json({ error: error.message || "Failed to reduce approved hours." });
  }
});

app.get("/api/admin/review/projects/:id/participant-pending-orders", requireStaffReview, async (req, res) => {
  try {
    const result = await getParticipantPendingOrdersForReview(req.params.id);
    res.json(result);
  } catch (error) {
    console.error("Failed to load participant pending orders:", error);
    res.status(400).json({ error: error.message || "Failed to load pending orders." });
  }
});

app.post("/api/admin/review/projects/:id/participant-orders/:orderId/reject", requireStaffReview, async (req, res) => {
  try {
    const result = await rejectParticipantOrderForReview(req.params.id, req.params.orderId);
    res.json(result);
  } catch (error) {
    console.error("Failed to reject participant order from review:", error);
    res.status(400).json({ error: error.message || "Failed to reject order." });
  }
});

app.delete("/api/admin/review/projects/:id", requireSuperAdmin, async (req, res) => {
  try {
    const deleted = await deleteProjectBySuperadmin(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete review project:", error);
    res.status(500).json({ error: "Failed to delete project." });
  }
});

app.get("/api/admin/shop/items", requireFullAdmin, async (req, res) => {
  try {
    const items = await listShopItems({ includeInactive: true });
    res.json({ items });
  } catch (error) {
    console.error("Failed to load admin shop items:", error);
    res.status(500).json({ error: "Failed to load admin shop items." });
  }
});

app.post("/api/admin/shop/items", requireFullAdmin, async (req, res) => {
  try {
    const item = await createShopItem(req.body);
    res.status(201).json({ item });
  } catch (error) {
    console.error("Failed to create shop item:", error);
    res.status(500).json({ error: "Failed to create shop item." });
  }
});

app.patch("/api/admin/shop/items/:id", requireFullAdmin, async (req, res) => {
  try {
    const item = await updateShopItem(req.params.id, req.body);
    if (!item) {
      res.status(404).json({ error: "Shop item not found." });
      return;
    }
    res.json({ item });
  } catch (error) {
    console.error("Failed to update shop item:", error);
    res.status(500).json({ error: "Failed to update shop item." });
  }
});

app.delete("/api/admin/shop/items/:id", requireFullAdmin, async (req, res) => {
  try {
    const deleted = await deleteShopItem(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Shop item not found." });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete shop item:", error);
    res.status(500).json({ error: "Failed to delete shop item." });
  }
});

app.post("/api/admin/shop/items/bulk_active", requireFullAdmin, async (req, res) => {
  try {
    await setAllShopItemsActive(req.body?.active);
    res.json({ ok: true });
  } catch (error) {
    console.error("Failed to bulk update shop items:", error);
    res.status(500).json({ error: "Failed to update shop items." });
  }
});

app.post("/api/admin/shop/items/reorder", requireFullAdmin, async (req, res) => {
  try {
    const items = await reorderShopItems(req.body?.order);
    res.json({ items });
  } catch (error) {
    console.error("Failed to reorder shop items:", error);
    res.status(400).json({ error: error.message || "Failed to reorder shop items." });
  }
});

app.get("/api/admin/shop/orders", requireFullAdmin, async (req, res) => {
  try {
    const orders = await listShopOrders();
    res.json({ orders });
  } catch (error) {
    console.error("Failed to load shop orders:", error);
    res.status(500).json({ error: "Failed to load shop orders." });
  }
});

app.post("/api/admin/shop/orders/:id/fulfill", requireFullAdmin, async (req, res) => {
  try {
    const order = await markShopOrderFulfilled(req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    res.json({ order });
  } catch (error) {
    console.error("Failed to fulfill shop order:", error);
    res.status(500).json({ error: "Failed to fulfill order." });
  }
});

app.post("/api/admin/shop/orders/:id/reject", requireFullAdmin, async (req, res) => {
  try {
    const order = await rejectShopOrderWithRefund(req.params.id);
    res.json({ order });
  } catch (error) {
    console.error("Failed to reject shop order:", error);
    res.status(400).json({ error: error.message || "Failed to reject order." });
  }
});

app.get("/api/admin/stats", requireFullAdmin, async (req, res) => {
  try {
    const stats = await getAdminStats();
    res.json({ stats });
  } catch (error) {
    console.error("Failed to load admin stats:", error);
    res.status(500).json({ error: "Failed to load stats." });
  }
});

app.get("/api/admin/users", requireFullAdmin, async (req, res) => {
  try {
    const users = await listAdminUsers();
    res.json({ users });
  } catch (error) {
    console.error("Failed to load admin users:", error);
    res.status(500).json({ error: "Failed to load users." });
  }
});

app.get("/api/admin/users/:id", requireFullAdmin, async (req, res) => {
  try {
    const user = await getAdminUserWithProjects(req.params.id);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.json({ user });
  } catch (error) {
    console.error("Failed to load admin user:", error);
    res.status(500).json({ error: "Failed to load user." });
  }
});

app.patch("/api/admin/users/:id/balance", requireFullAdmin, async (req, res) => {
  const adminUserId = req.session?.userId;
  try {
    const { delta, reason } = req.body;
    const parsedDelta = Number(delta);
    if (!Number.isFinite(parsedDelta) || parsedDelta === 0) {
      res.status(400).json({ error: "delta must be a non-zero number." });
      return;
    }
    const updated = await adjustUserCoins(adminUserId, req.params.id, { delta: parsedDelta, reason });
    console.log(`[admin] balance_adjustment user=${req.params.id} delta=${parsedDelta} by admin=${adminUserId}`);
    res.json({ user: updated });
  } catch (error) {
    console.error("Failed to adjust user balance:", error);
    res.status(400).json({ error: error.message || "Failed to adjust balance." });
  }
});

app.get("/api/admin/users/:id/audit", requireFullAdmin, async (req, res) => {
  try {
    const entries = await getAuditLogForTarget("user", req.params.id);
    res.json({ entries });
  } catch (error) {
    console.error("Failed to load audit log:", error);
    res.status(500).json({ error: "Failed to load audit log." });
  }
});

app.get("/api/airtable/status", requireFullAdmin, (req, res) => {
  res.json({
    ...getAirtableSyncStatus(),
    periodic: getPeriodicAirtableSyncStatus(),
    ysws: getYswsAirtableConfigStatus(),
    orders: getOrdersAirtableConfigStatus(),
  });
});

app.post("/api/airtable/sync", async (req, res) => {
  const secretMatch = AIRTABLE_SYNC_SECRET && req.headers["x-sync-secret"] === AIRTABLE_SYNC_SECRET;
  const isAdmin = req.session?.userId
    ? await getUserById(req.session.userId).then((row) => canAccessFullAdmin(effectiveRole(row))).catch(() => false)
    : false;
  if (!secretMatch && !isAdmin) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    const result = await syncAllUsersAndProjectsToAirtable();
    res.status(result.ok ? 200 : 503).json(result);
  } catch (error) {
    console.error("Manual Airtable sync failed:", error);
    res.status(500).json({
      ok: false,
      error: "Manual Airtable sync failed.",
      message: clientErrorMessage(error, "Manual Airtable sync failed."),
    });
  }
});

if (isProd) {
  const dist = path.join(__dirname, "../client/dist");
  app.use(express.static(dist));
  app.get("*", spaRateLimiter, (req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.use(handleCsrfError);

async function startServer() {
  if (hasDatabaseConfig) {
    try {
      const { tables } = await runDatabaseMigration();
      console.log(`[db] Database schema is up to date (${tables.length} tables).`);
    } catch (error) {
      console.error("[db] Failed to ensure database tables:", error);
      if (isProd) {
        throw error;
      }
    }
  } else if (!isProd) {
    console.warn("[db] DATABASE_URL is not set; skipping migrations (set it in .env for local platform data).");
  }

  console.log(`[auth] Hack Club OAuth ${isHackClubAuthEnabled() ? "enabled" : "disabled"}.`);
  console.log(`[hackatime] OAuth ${isHackatimeOAuthConfigured() ? "configured" : "not configured"}.`);

  const devUiPort = process.env.VITE_DEV_PORT || "5174";
  const server = app.listen(PORT, HOST, () => {
    console.log(
      `Server http://${HOST}:${PORT} (${isProd ? "serving React build" : `API only - use Vite on :${devUiPort} for UI`})`
    );
  });

  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
      console.error(
        `[server] Port ${PORT} is already in use (Stack defaults to :3000). Set PORT and VITE_DEV_PORT in .env for this project.`
      );
      process.exit(1);
    }
    throw error;
  });

  const yswsConfig = getYswsAirtableConfigStatus();
  console.log(
    `[ysws] Airtable YSWS submissions ${yswsConfig.configured ? "configured" : "not configured"}` +
      (yswsConfig.configured
        ? ` (base=${yswsConfig.baseId}, table=${yswsConfig.table} [${yswsConfig.tableKind}], fields=${yswsConfig.fieldMode})`
        : "")
  );
  if (hasAirtableYswsConfig) {
    warmYswsFieldMap().catch((error) => {
      console.error("[ysws] Failed to resolve YSWS field map:", error instanceof Error ? error.message : error);
    });
  }
  const ordersConfig = getOrdersAirtableConfigStatus();
  console.log(
    `[orders] Airtable shop orders ${ordersConfig.configured ? "configured" : "not configured"}` +
      (ordersConfig.configured
        ? ` (base=${ordersConfig.baseId}, table=${ordersConfig.table} [${ordersConfig.tableKind}])`
        : "")
  );
  if (hasAirtableOrdersConfig) {
    warmOrdersFieldMap().catch((error) => {
      console.error("[orders] Failed to resolve orders field map:", error instanceof Error ? error.message : error);
    });
  }
  startPeriodicAirtableSync();
}

startServer().catch((error) => {
  console.error("[boot] Server failed to start:", error);
  process.exit(1);
});
