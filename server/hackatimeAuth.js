import { getAppOrigin } from "./hackclubAuth.js";

const HACKATIME_BASE = "https://hackatime.hackclub.com";
export const HACKATIME_OAUTH_CALLBACK_PATH = "/api/auth/hackatime/callback";

const HACKATIME_CLIENT_ID_ENV_NAMES = [
  "HACKATIME_UID",
  "HACKATIME_CLIENT_ID",
  "HACKATIME_OAUTH_CLIENT_ID",
];
const HACKATIME_CLIENT_SECRET_ENV_NAMES = [
  "HACKATIME_SECRET",
  "HACKATIME_CLIENT_SECRET",
  "HACKATIME_OAUTH_CLIENT_SECRET",
];

function readEnvValue(...names) {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw !== "string") continue;
    const value = raw.trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return "";
}

export function getHackatimeClientId() {
  return readEnvValue(...HACKATIME_CLIENT_ID_ENV_NAMES);
}

export function getHackatimeClientSecret() {
  return readEnvValue(...HACKATIME_CLIENT_SECRET_ENV_NAMES);
}

export function isHackatimeOAuthConfigured() {
  return Boolean(getHackatimeClientId() && getHackatimeClientSecret());
}

function requiredHackatimeClientId() {
  const value = getHackatimeClientId();
  if (!value) {
    throw new Error(
      `Hackatime client id is not set (expected one of: ${HACKATIME_CLIENT_ID_ENV_NAMES.join(", ")}).`
    );
  }
  return value;
}

function requiredHackatimeClientSecret() {
  const value = getHackatimeClientSecret();
  if (!value) {
    throw new Error(
      `Hackatime client secret is not set (expected one of: ${HACKATIME_CLIENT_SECRET_ENV_NAMES.join(", ")}).`
    );
  }
  return value;
}

export function resolveHackatimeRedirectUri(req) {
  const configured = readEnvValue("HACKATIME_REDIRECT_URI");
  if (configured) {
    return configured;
  }

  const originHeader = req?.get?.("Origin");
  if (originHeader) {
    try {
      const origin = new URL(originHeader).origin;
      return `${origin}${HACKATIME_OAUTH_CALLBACK_PATH}`;
    } catch {
      // ignore
    }
  }

  const appOrigin = readEnvValue("APP_ORIGIN") || getAppOrigin();
  return `${appOrigin.replace(/\/$/, "")}${HACKATIME_OAUTH_CALLBACK_PATH}`;
}

export function getHackatimeAuthorizeUrl({ state, redirectUri }) {
  const clientId = requiredHackatimeClientId();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "profile read",
    state,
  });

  return `${HACKATIME_BASE}/oauth/authorize?${params.toString()}`;
}

export async function exchangeHackatimeAuthorizationCode(code, redirectUri) {
  const clientId = requiredHackatimeClientId();
  const clientSecret = requiredHackatimeClientSecret();

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
    grant_type: "authorization_code",
  });

  const response = await fetch(`${HACKATIME_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Hackatime token response was not JSON.");
  }

  if (!response.ok) {
    const msg = data.error_description || data.error || response.statusText;
    throw new Error(`Hackatime token exchange failed: ${msg}`);
  }

  return data;
}

async function hackatimeApiGet(accessToken, path, query = {}) {
  const params = new URLSearchParams(query);
  const qs = params.toString();
  const url = `${HACKATIME_BASE}${path}${qs ? `?${qs}` : ""}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Hackatime API ${path} returned non-JSON.`);
  }

  if (!response.ok) {
    const msg = data.error || data.message || response.statusText;
    throw new Error(`Hackatime API ${path} failed: ${msg}`);
  }

  return data;
}

export async function fetchHackatimeMe(accessToken) {
  return hackatimeApiGet(accessToken, "/api/v1/authenticated/me");
}

export const STACK_LAUNCH_UTC = new Date("2026-06-05T04:00:00Z");

export function isStackLaunched(now = new Date()) {
  return now.getTime() >= STACK_LAUNCH_UTC.getTime();
}

/** Hackatime stats range: ISO 8601 (API rejects bare YYYY-MM-DD dates). */
export function stackHackatimeStatsRange(now = new Date()) {
  return {
    start: STACK_LAUNCH_UTC.toISOString(),
    end: now.toISOString(),
  };
}

export async function fetchHackatimeProjects(accessToken, { includeArchived = false, start = null, end = null } = {}) {
  const query = { include_archived: includeArchived ? "true" : "false" };
  if (start) query.start = start;
  if (end) query.end = end;
  const data = await hackatimeApiGet(accessToken, "/api/v1/authenticated/projects", query);

  const projects = Array.isArray(data.projects) ? data.projects : [];
  return projects.map((project) => ({
    name: project.name,
    totalSeconds: Number(project.total_seconds ?? 0),
    totalHours: Number((Number(project.total_seconds ?? 0) / 3600).toFixed(2)),
    languages: project.languages || [],
    archived: Boolean(project.archived),
    mostRecentHeartbeat: project.most_recent_heartbeat ?? null,
  }));
}

export async function fetchHackatimeProjectsForStack(accessToken) {
  const allProjects = await fetchHackatimeProjects(accessToken);

  if (!isStackLaunched()) {
    return allProjects.map((p) => ({
      ...p,
      allTimeSeconds: p.totalSeconds,
      allTimeHours: p.totalHours,
      totalSeconds: 0,
      totalHours: 0,
    }));
  }

  const postLaunchProjects = await fetchHackatimeProjects(accessToken, stackHackatimeStatsRange());
  const postLaunchByName = new Map(
    postLaunchProjects.map((p) => [p.name.trim().toLowerCase(), p])
  );

  return allProjects.map((p) => {
    const key = p.name.trim().toLowerCase();
    const post = postLaunchByName.get(key);
    const newSeconds = post?.totalSeconds ?? 0;
    return {
      ...p,
      allTimeSeconds: p.totalSeconds,
      allTimeHours: p.totalHours,
      totalSeconds: newSeconds,
      totalHours: Number((newSeconds / 3600).toFixed(2)),
    };
  });
}

export async function fetchHackatimeTotalHours(accessToken) {
  const data = await hackatimeApiGet(accessToken, "/api/v1/authenticated/hours", {});
  const seconds = Number(data.total_seconds ?? 0);
  return {
    totalSeconds: seconds,
    totalHours: Number((seconds / 3600).toFixed(2)),
    startDate: data.start_date ?? null,
    endDate: data.end_date ?? null,
  };
}

export function sumHackatimeHoursForNames(hackatimeProjects, linkedNames) {
  const names = new Set(
    (Array.isArray(linkedNames) ? linkedNames : [])
      .map((name) => String(name).trim().toLowerCase())
      .filter(Boolean)
  );
  if (names.size === 0) return 0;

  let seconds = 0;
  for (const project of hackatimeProjects) {
    if (names.has(String(project.name).trim().toLowerCase())) {
      seconds += Number(project.totalSeconds ?? 0);
    }
  }

  return Number((seconds / 3600).toFixed(2));
}
