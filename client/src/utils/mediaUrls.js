import { isHackClubCdnHostname, isHackClubCdnUrl } from "./cdnLinks.js";

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|mp4|webm|ogg|mov)$/i;
const MARKDOWN_MEDIA_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const CDN_URL_RE =
  /https:\/\/(?:cdn\.hackclub\.com|(?:[a-z0-9-]+\.)*hackclub-assets\.com)\/[^\s)>\]]+/gi;

/** Strip markdown title syntax and angle brackets from a link target. */
export function normalizeMarkdownLinkTarget(raw) {
  if (!raw || typeof raw !== "string") return "";
  let url = raw.trim();
  if (url.startsWith("<") && url.endsWith(">")) {
    url = url.slice(1, -1).trim();
  }
  const titleMatch = url.match(/\s+["'][^"']*["']\s*$/);
  if (titleMatch) {
    url = url.slice(0, url.indexOf(titleMatch[0])).trim();
  }
  return url;
}

/** Encode path segments so spaces and special chars in CDN filenames load correctly. */
export function encodeMediaUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url, typeof window !== "undefined" ? window.location.origin : undefined);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (isHackClubCdnHostname(parsed.hostname) && parsed.protocol === "http:") {
      parsed.protocol = "https:";
    }
    const segments = parsed.pathname.split("/");
    const encodedPath = segments
      .map((segment) => {
        if (!segment) return segment;
        try {
          return encodeURIComponent(decodeURIComponent(segment));
        } catch {
          return encodeURIComponent(segment);
        }
      })
      .join("/");
    parsed.pathname = encodedPath;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Resolve project/journal asset URLs for the current app origin.
 * Rewrites dev upload hosts and relative /uploads paths so images work in review.
 */
export function resolveStackAssetUrl(url) {
  const normalized = normalizeMarkdownLinkTarget(url);
  if (!normalized) return null;

  if (!/^https?:\/\//i.test(normalized) && !normalized.startsWith("/")) {
    if (IMAGE_EXT_RE.test(normalized)) {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const filename = normalized.replace(/^\.\//, "");
      return encodeMediaUrl(`${origin}/uploads/cdn/${filename}`);
    }
    return null;
  }

  try {
    const parsed = new URL(normalized, typeof window !== "undefined" ? window.location.origin : undefined);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    if (parsed.pathname.startsWith("/uploads/")) {
      const origin = typeof window !== "undefined" ? window.location.origin : parsed.origin;
      return encodeMediaUrl(`${origin}${parsed.pathname}${parsed.search}`);
    }

    return encodeMediaUrl(parsed.href);
  } catch {
    if (normalized.startsWith("/uploads/") && typeof window !== "undefined") {
      return encodeMediaUrl(`${window.location.origin}${normalized}`);
    }
    return normalized.startsWith("/uploads/") ? normalized : null;
  }
}

/** @param {string} url */
export function isAllowedJournalMediaUrl(url) {
  const normalized = normalizeMarkdownLinkTarget(url);
  if (!normalized) return false;

  if (!/^https?:\/\//i.test(normalized) && !normalized.startsWith("/")) {
    return IMAGE_EXT_RE.test(normalized);
  }

  try {
    const parsed = new URL(normalized, typeof window !== "undefined" ? window.location.origin : undefined);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.pathname.startsWith("/uploads/")) return true;
    if (isHackClubCdnHostname(parsed.hostname)) return true;
    if (parsed.hostname.endsWith(".hackclub.com")) return true;
    if (typeof window !== "undefined" && parsed.hostname === window.location.hostname) return true;
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return IMAGE_EXT_RE.test(normalized);
  }
}

function pushMediaPart(parts, alt, rawUrl) {
  const trimmedUrl = String(rawUrl ?? "").trim();
  const altLooksLikeFile = IMAGE_EXT_RE.test(alt);

  if (!trimmedUrl && altLooksLikeFile) {
    parts.push({ type: "media", alt, url: null, rawUrl: "" });
    return;
  }

  if (!trimmedUrl) {
    parts.push({ type: "text", value: `![${alt}]()` });
    return;
  }

  if (!isAllowedJournalMediaUrl(trimmedUrl)) {
    parts.push({ type: "text", value: `![${alt}](${trimmedUrl})` });
    return;
  }

  const resolved = resolveStackAssetUrl(trimmedUrl);
  const normalized = normalizeMarkdownLinkTarget(trimmedUrl);
  if (resolved || normalized || altLooksLikeFile) {
    parts.push({
      type: "media",
      alt,
      url: resolved,
      rawUrl: normalized || trimmedUrl,
    });
  } else {
    parts.push({ type: "text", value: `![${alt}](${trimmedUrl})` });
  }
}


function isHackClubCdnOnlyUrl(url) {
  const normalized = normalizeMarkdownLinkTarget(url);
  if (!normalized) return false;
  return isHackClubCdnUrl(normalized);
}

/**
 * Journal attachment src for display.
 * - Participants: direct https://cdn.hackclub.com URLs (journal entries are CDN-only server-side).
 * - Staff review: server proxy for encoding, legacy uploads, and filename lookup.
 */
export function journalDisplaySrc({ resolved, rawUrl, alt, staffReview = false }) {
  if (typeof window === "undefined") return resolved || null;

  const source = rawUrl || resolved;
  if (!source && !(alt && IMAGE_EXT_RE.test(alt))) return null;

  if (!staffReview) {
    if (isHackClubCdnOnlyUrl(source)) {
      return encodeMediaUrl(source);
    }
    return null;
  }

  const origin = window.location.origin;
  const params = new URLSearchParams();

  if (source) {
    params.set("url", source);
  }
  if (alt && IMAGE_EXT_RE.test(alt)) {
    params.set("filename", alt);
  }

  if ([...params.keys()].length === 0) return null;
  return `${origin}/api/admin/review/media?${params.toString()}`;
}

function collectMarkdownRanges(text) {
  const ranges = [];
  let match;
  const re = new RegExp(MARKDOWN_MEDIA_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      alt: match[1],
      rawUrl: match[2],
    });
  }
  return ranges;
}

/**
 * @param {string | null | undefined} text
 * @returns {Array<{ type: "text", value: string } | { type: "media", alt: string, url: string }>}
 */
export function parseJournalDescription(text) {
  if (!text) return [];

  const parts = [];
  const markdownRanges = collectMarkdownRanges(text);
  let cursor = 0;
  for (const range of markdownRanges) {
    if (range.start > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, range.start) });
    }
    pushMediaPart(parts, range.alt, range.rawUrl);
    cursor = range.end;
  }

  if (cursor < text.length) {
    const tail = text.slice(cursor);
    const cdnRe = new RegExp(CDN_URL_RE.source, "gi");
    let last = 0;
    let cdnMatch;
    while ((cdnMatch = cdnRe.exec(tail)) !== null) {
      if (cdnMatch.index > last) {
        parts.push({ type: "text", value: tail.slice(last, cdnMatch.index) });
      }
      pushMediaPart(parts, "Journal attachment", cdnMatch[0]);
      last = cdnMatch.index + cdnMatch[0].length;
    }
    if (last < tail.length) {
      parts.push({ type: "text", value: tail.slice(last) });
    }
  }

  if (parts.length === 0) {
    parts.push({ type: "text", value: text });
  }

  return parts;
}

export function isVideoUrl(url) {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  return ["mp4", "webm", "ogg", "mov"].includes(ext);
}
