export const CDN_UPLOAD_HELP =
  "To upload imgs and videos, use #cdn on Slack, and paste the link here!";

/** Public Hack Club CDN hostnames (v4 may serve from hackclub-assets.com). */
export function isHackClubCdnHostname(hostname) {
  if (!hostname || typeof hostname !== "string") return false;
  const host = hostname.toLowerCase();
  if (host === "cdn.hackclub.com") return true;
  if (host === "cdn.hackclub-assets.com") return true;
  if (host === "user-cdn.hackclub-assets.com") return true;
  if (host.endsWith(".hackclub-assets.com")) return true;
  return false;
}

export function isHackClubCdnUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" && isHackClubCdnHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function normalizeHackClubCdnUrl(value) {
  if (!isHackClubCdnUrl(value)) return null;
  return new URL(value.trim()).href;
}

export function markdownImageForCdnUrl(url) {
  const clean = normalizeHackClubCdnUrl(url);
  if (!clean) return null;
  const name = decodeURIComponent(clean.split("/").pop()?.split("?")[0] || "attachment");
  return `![${name}](${clean})`;
}

const MARKDOWN_MEDIA_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

export function journalDescriptionMediaIsCdnOnly(description) {
  if (!description || typeof description !== "string") return true;

  let match;
  const re = new RegExp(MARKDOWN_MEDIA_RE.source, "g");
  while ((match = re.exec(description)) !== null) {
    const target = match[1].trim();
    if (!target || !isHackClubCdnUrl(target)) return false;
  }

  return true;
}
