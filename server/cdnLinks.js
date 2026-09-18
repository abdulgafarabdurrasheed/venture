function textOrNull(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/** Public Hack Club CDN hostnames (v4 may redirect to hackclub-assets.com). */
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

export function safeHackClubCdnUrl(value) {
  const text = textOrNull(value);
  if (!text) return null;
  if (!isHackClubCdnUrl(text)) {
    throw new Error("URL must be a Hack Club CDN link from #cdn on Slack.");
  }
  return new URL(text).href;
}

const MARKDOWN_MEDIA_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

export function assertJournalDescriptionMediaIsCdnOnly(description) {
  const text = textOrNull(description);
  if (!text) return;

  let match;
  const re = new RegExp(MARKDOWN_MEDIA_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    const target = match[1].trim();
    if (!target || !isHackClubCdnUrl(target)) {
      throw new Error(
        "Journal attachments must be Hack Club CDN links from #cdn on Slack (use ![label](url) in the description)."
      );
    }
  }
}
