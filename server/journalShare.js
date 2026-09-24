import crypto from "crypto";

import { getAppOrigin } from "./hackclubAuth.js";

function signingSecret() {
  return process.env.JOURNALING_LINK_SECRET?.trim() || process.env.SESSION_SECRET?.trim() || "";
}

export function isJournalSharingConfigured() {
  return Boolean(process.env.JOURNALING_PW?.trim() && signingSecret());
}

export function journalShareToken(projectId) {
  const secret = signingSecret();
  if (!secret) return "";
  return crypto
    .createHmac("sha256", secret)
    .update(`venture:journaling:${String(projectId)}`)
    .digest("base64url");
}

export function isValidJournalShareToken(projectId, token) {
  const expected = journalShareToken(projectId);
  const provided = String(token || "");
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    crypto.timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

export function buildJournalShareUrl(projectId) {
  const token = journalShareToken(projectId);
  if (!token) return "";
  const origin = getAppOrigin().replace(/\/+$/, "");
  return `${origin}/journaling/${encodeURIComponent(projectId)}/${encodeURIComponent(token)}`;
}
