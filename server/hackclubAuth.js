const AUTH_BASE = "https://auth.hackclub.com";
const OAUTH_CALLBACK_PATH = "/api/auth/hackclub/callback";
const DEFAULT_SCOPES = [
  "openid",
  "email",
  "name",
  "profile",
  "birthdate",
  "address",
  "verification_status",
  "slack_id",
  "basic_info",
];

function buildCallbackUri(origin) {
  const trimmedOrigin = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return `${trimmedOrigin}${OAUTH_CALLBACK_PATH}`;
}

function readEnvValue(name) {
  const raw = process.env[name];
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/^["']|["']$/g, "");
}

function requiredEnv(name) {
  const value = readEnvValue(name);
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

export function isHackClubAuthConfigured() {
  return Boolean(readEnvValue("HC_CLIENT_ID") && readEnvValue("HC_CLIENT_SECRET"));
}

/** Hack Club OAuth is disabled only in local development (NODE_ENV=development). */
export function isHackClubAuthEnabled() {
  if (!isHackClubAuthConfigured()) return false;
  return process.env.NODE_ENV !== "development";
}

export function getAllowedRedirectUris() {
  const primary = readEnvValue("HC_REDIRECT_URI");
  const set = new Set();

  if (primary) {
    set.add(primary);
  }

  const appOrigin = readEnvValue("APP_ORIGIN");
  if (appOrigin) {
    set.add(buildCallbackUri(appOrigin));
  }

  for (const piece of (process.env.OAUTH_ALLOWED_REDIRECT_URIS || "").split(",")) {
    const u = piece.trim();
    if (u) set.add(u);
  }

  if (primary) {
    try {
      const url = new URL(primary);
      const port = url.port ? `:${url.port}` : "";
      if (url.hostname === "localhost") {
        set.add(`${url.protocol}//127.0.0.1${port}${url.pathname}`);
      } else if (url.hostname === "127.0.0.1") {
        set.add(`${url.protocol}//localhost${port}${url.pathname}`);
      }
    } catch {
      // ignore
    }
  }

  return [...set];
}

function parseRequestOrigin(req) {
  const originHeader = req.get("Origin");
  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      return parsed.origin;
    } catch {
    }
  }

  const referer = req.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }

  const forwardedHost = req.get("X-Forwarded-Host");
  const host = (forwardedHost || req.get("Host") || "").split(",")[0].trim();
  const forwardedProto = req.get("X-Forwarded-Proto");
  const protocol =
    (forwardedProto || req.protocol || "").split(",")[0].trim() ||
    (process.env.NODE_ENV === "production" ? "https" : "http");

  if (host && protocol) {
    return `${protocol}://${host}`;
  }

  return null;
}


export function resolveOAuthRedirectUri(req) {
  const allowed = getAllowedRedirectUris();
  const origin = parseRequestOrigin(req);
  if (allowed.length === 0) {
    if (origin) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[auth] No explicit OAuth redirect URI configured; using request origin callback ${buildCallbackUri(origin)}`
        );
      }
      return buildCallbackUri(origin);
    }
    throw new Error("HC_REDIRECT_URI (or APP_ORIGIN) is not set.");
  }

  if (origin) {
    const candidate = buildCallbackUri(origin);
    if (allowed.includes(candidate)) {
      return candidate;
    }
  }

  const fallback = readEnvValue("HC_REDIRECT_URI") || allowed[0];
  if (process.env.NODE_ENV !== "production" && origin) {
    console.warn(
      `[auth] No allowlisted redirect for origin ${origin}. Using configured fallback ${fallback}. Register in Hack Club: ${origin}/api/auth/hackclub/callback`
    );
  }

  return fallback;
}

export function appOriginFromRedirectUri(redirectUri) {
  try {
    return new URL(redirectUri).origin;
  } catch {
    return getAppOrigin();
  }
}

export function getAuthorizeUrl({ state, redirectUri }) {
  const clientId = requiredEnv("HC_CLIENT_ID");
  const configuredScopes = (process.env.HC_SCOPES || "").trim();
  const scopeList = configuredScopes
    ? configuredScopes.split(/\s+/).filter(Boolean)
    : DEFAULT_SCOPES;
  const scope = [...new Set(scopeList)].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state,
  });

  return `${AUTH_BASE}/oauth/authorize?${params.toString()}`;
}

export async function exchangeAuthorizationCode(code, redirectUri) {
  const clientId = requiredEnv("HC_CLIENT_ID");
  const clientSecret = requiredEnv("HC_CLIENT_SECRET");

  const body = {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
    grant_type: "authorization_code",
  };

  const response = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Hack Club token response was not JSON.");
  }

  if (!response.ok) {
    const msg = data.error_description || data.error || response.statusText;
    throw new Error(`Token exchange failed: ${msg}`);
  }

  return data;
}

function buildNameFromIdentity(identity) {
  if (typeof identity?.name === "string" && identity.name.trim()) {
    return identity.name.trim();
  }

  const parts = [identity?.first_name, identity?.last_name].filter(
    (part) => typeof part === "string" && part.trim()
  );
  if (parts.length > 0) {
    return parts.join(" ");
  }

  return identity?.username ?? identity?.slug ?? null;
}

/** Stack-style display handle: Slack username first, not legal full name. */
export function slackDisplayNameFromProfile(profile) {
  const identity = profile?.identity && typeof profile.identity === "object" ? profile.identity : profile;
  if (!identity || typeof identity !== "object") return null;

  const slackUsername = identity.slack_username ?? identity.slack?.username;
  if (typeof slackUsername === "string" && slackUsername.trim()) {
    return slackUsername.trim();
  }
  if (typeof identity.slug === "string" && identity.slug.trim()) {
    return identity.slug.trim();
  }
  if (typeof identity.username === "string" && identity.username.trim()) {
    return identity.username.trim();
  }

  const email =
    identity.email ?? identity.primary_email ?? identity.email_address ?? identity.primaryEmail ?? null;
  if (typeof email === "string" && email.includes("@")) {
    return email.split("@")[0];
  }

  return null;
}

export function normalizeHackClubMeResponse(data) {
  if (!data || typeof data !== "object") {
    return data;
  }

  if (data.identity && typeof data.identity === "object") {
    const identity = data.identity;
    const email =
      identity.email ??
      identity.primary_email ??
      identity.email_address ??
      identity.primaryEmail ??
      null;

    return {
      ...identity,
      scopes: data.scopes,
      sub: identity.sub ?? identity.id,
      public_id: identity.public_id ?? identity.id,
      identity_id: identity.identity_id ?? identity.id,
      email,
      name: slackDisplayNameFromProfile(identity) ?? buildNameFromIdentity(identity),
      slack_id: identity.slack_id ?? identity.slackId ?? null,
      verification_status: identity.verification_status ?? identity.verificationStatus ?? null,
    };
  }

  return data;
}

export function describeHackClubProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return { present: false };
  }

  return {
    topLevelKeys: Object.keys(profile),
    id: profile.id ?? null,
    public_id: profile.public_id ?? null,
    identity_id: profile.identity_id ?? null,
    sub: profile.sub ?? null,
    hasEmail: Boolean(profile.email ?? profile.primary_email ?? profile.email_address),
    hasSlackId: Boolean(profile.slack_id),
    hasName: Boolean(profile.name ?? profile.first_name ?? profile.last_name),
    wrappedIdentity: Boolean(profile.identity),
  };
}

export async function fetchHackClubMe(accessToken) {
  const response = await fetch(`${AUTH_BASE}/api/v1/me`, {
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
    throw new Error("Hack Club /me response was not JSON.");
  }

  if (!response.ok) {
    const msg = data.error || data.message || response.statusText;
    throw new Error(`Hack Club /api/v1/me failed: ${msg}`);
  }

  return normalizeHackClubMeResponse(data);
}

export function getAppOrigin() {
  return process.env.APP_ORIGIN || "http://127.0.0.1:5174";
}
