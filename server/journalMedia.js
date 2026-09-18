import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { isHackClubCdnHostname } from "./cdnLinks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, "uploads");
const UPLOAD_SUBDIRS = ["cdn", "project-images"];
const MAX_PROXY_BYTES = 26 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|mp4|webm|ogg|mov)$/i;

const MIME_BY_EXT = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "video/ogg",
  ogv: "video/ogg",
  mov: "video/quicktime",
};

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

export function isBareMediaFilename(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return false;
  if (trimmed.startsWith("/")) return false;
  return IMAGE_EXT_RE.test(trimmed);
}

function normalizeRemoteUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value) return null;

  if (value.startsWith("/uploads/")) {
    return value;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (isHackClubCdnHostname(parsed.hostname) && parsed.protocol === "http:") {
      parsed.protocol = "https:";
    }
    const segments = parsed.pathname.split("/");
    parsed.pathname = segments
      .map((segment) => {
        if (!segment) return segment;
        try {
          return encodeURIComponent(decodeURIComponent(segment));
        } catch {
          return encodeURIComponent(segment);
        }
      })
      .join("/");
    return parsed.href;
  } catch {
    return null;
  }
}

export function isAllowedMediaUrl(urlString) {
  if (!urlString || typeof urlString !== "string") return false;
  const trimmed = urlString.trim();
  if (isBareMediaFilename(trimmed)) return true;
  if (trimmed.startsWith("/uploads/")) return true;

  const normalized = normalizeRemoteUrl(trimmed);
  if (!normalized) return false;
  if (normalized.startsWith("/uploads/")) return true;

  try {
    const parsed = new URL(normalized);
    if (parsed.pathname.startsWith("/uploads/")) return true;
    if (isHackClubCdnHostname(parsed.hostname)) return true;
    if (parsed.hostname.endsWith(".hackclub.com")) return true;
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return true;
    return false;
  } catch {
    return false;
  }
}

function uploadsPathFromUrl(urlString) {
  let pathname = null;
  if (urlString.startsWith("/uploads/")) {
    pathname = urlString.split("?")[0];
  } else {
    try {
      const parsed = new URL(urlString);
      if (parsed.pathname.startsWith("/uploads/")) {
        pathname = parsed.pathname;
      }
    } catch {
      return null;
    }
  }

  if (!pathname) return null;
  const relative = pathname.slice("/uploads/".length);
  if (relative.includes("..")) return null;
  return path.join(UPLOADS_ROOT, relative);
}

async function readLocalFileSafe(absolutePath) {
  const resolved = path.resolve(absolutePath);
  const root = path.resolve(UPLOADS_ROOT);
  if (!resolved.startsWith(root)) return null;

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > MAX_PROXY_BYTES) return null;
    const buffer = await fs.readFile(resolved);
    return { buffer, contentType: mimeFromPath(resolved) };
  } catch {
    return null;
  }
}

async function findLocalByBasename(basename) {
  if (!basename || basename.includes("..")) return null;
  const needle = basename.trim().toLowerCase();
  const stem = needle.replace(/\.[a-z0-9]+$/i, "");

  for (const subdir of UPLOAD_SUBDIRS) {
    const dir = path.join(UPLOADS_ROOT, subdir);
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }

    const exact = entries.find((name) => name.toLowerCase() === needle);
    if (exact) {
      const hit = await readLocalFileSafe(path.join(dir, exact));
      if (hit) return hit;
    }

    if (stem.length >= 4) {
      const partial = entries.find((name) => name.toLowerCase().includes(stem));
      if (partial) {
        const hit = await readLocalFileSafe(path.join(dir, partial));
        if (hit) return hit;
      }
    }
  }

  return null;
}

async function fetchRemote(urlString) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(urlString, {
      signal: controller.signal,
      headers: {
        Accept: "image/*,video/*,*/*",
        "User-Agent": "Stack-Review-Media-Proxy/1.0",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return null;
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_PROXY_BYTES) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_PROXY_BYTES) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    return { buffer, contentType: contentType.split(";")[0].trim() };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function candidateUrls(url) {
  if (!url) return [];
  const trimmed = url.trim();
  const out = new Set();

  const normalized = normalizeRemoteUrl(trimmed);
  if (normalized) out.add(normalized);

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    out.add(trimmed);
    try {
      out.add(decodeURI(trimmed));
    } catch {
      // ignore
    }
  }

  if (trimmed.startsWith("/uploads/")) {
    out.add(trimmed);
  }

  return [...out];
}

/**
 * Resolve journal / review attachment bytes for staff (CDN fetch + local uploads).
 */
export async function resolveJournalMediaPayload({ url, filename }) {
  const namesToTry = new Set();
  if (filename) namesToTry.add(filename);
  if (url && isBareMediaFilename(url)) namesToTry.add(url);

  for (const name of namesToTry) {
    const byName = await findLocalByBasename(name);
    if (byName) return byName;
  }

  if (url && !isBareMediaFilename(url)) {
    for (const candidate of candidateUrls(url)) {
      const localFromPath = uploadsPathFromUrl(candidate);
      if (localFromPath) {
        const local = await readLocalFileSafe(localFromPath);
        if (local) return local;
      }
    }

    for (const candidate of candidateUrls(url)) {
      if (candidate.startsWith("/uploads/")) continue;

      try {
        const parsed = new URL(candidate);
        if (!parsed.pathname.startsWith("/uploads/")) {
          const remote = await fetchRemote(parsed.href);
          if (remote) return remote;
        }
      } catch {
        // try next candidate
      }

      const basename = (() => {
        try {
          return path.basename(new URL(candidate).pathname);
        } catch {
          return null;
        }
      })();
      if (basename) {
        const byName = await findLocalByBasename(basename);
        if (byName) return byName;
      }
    }
  }

  return null;
}

export async function streamJournalMediaForReview(req, res) {
  let url = typeof req.query.url === "string" ? req.query.url.trim() : "";
  let filename = typeof req.query.filename === "string" ? req.query.filename.trim() : "";

  if (isBareMediaFilename(url)) {
    if (!filename) filename = url;
    url = "";
  }

  if (!url && !filename) {
    res.status(400).json({ error: "Missing url or filename." });
    return;
  }

  if (url && !isAllowedMediaUrl(url)) {
    res.status(403).json({ error: "URL is not allowed." });
    return;
  }

  const payload = await resolveJournalMediaPayload({ url: url || undefined, filename: filename || undefined });
  if (!payload) {
    res.status(404).json({ error: "Media not found." });
    return;
  }

  res.setHeader("Content-Type", payload.contentType);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.send(payload.buffer);
}
