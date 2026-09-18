import { useEffect, useMemo } from "react";
import { PlatformShell } from "../platform/PlatformShell.jsx";
import "../platform/platform.css";

const ERROR_MESSAGES = {
  oauth_config:
    "Hack Club login is not configured on the server. Set HC_CLIENT_ID, HC_CLIENT_SECRET, and HC_REDIRECT_URI as runtime environment variables, then redeploy.",
  oauth_missing_code: "Hack Club did not return an authorization code.",
  oauth_state: "Login session expired. Please try again.",
  oauth_missing_redirect: "OAuth redirect URI was missing.",
  oauth_no_access_token: "Hack Club did not return an access token.",
  oauth_callback: "Hack Club login failed. Please try again.",
};

function normalizeReturnTo(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/projects";
  return value;
}

function isLocalDevHost() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

export function LoginPage() {
  const params = new URLSearchParams(window.location.search);
  const returnTo = useMemo(() => normalizeReturnTo(params.get("returnTo")), [params]);
  const errorCode = params.get("error");
  const errorMessage = ERROR_MESSAGES[errorCode] || (errorCode ? "Login failed. Please try again." : "");
  const isLocalDev = isLocalDevHost();

  useEffect(() => {
    if (isLocalDev) {
      window.location.replace(returnTo);
      return;
    }
    if (errorCode) return;
    const loginUrl = `/api/auth/hackclub/login?returnTo=${encodeURIComponent(returnTo)}`;
    window.location.replace(loginUrl);
  }, [errorCode, isLocalDev, returnTo]);

  if (isLocalDev) {
    return (
      <PlatformShell title="Login">
        <p>Redirecting to platform…</p>
      </PlatformShell>
    );
  }

  return (
    <PlatformShell title="Login">
      {errorMessage ? (
        <>
          <p className="platform-gate__error">{errorMessage}</p>
          <p>
            <a href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Try Hack Club login again</a>
          </p>
        </>
      ) : (
        <p>Redirecting to Hack Club Auth…</p>
      )}
    </PlatformShell>
  );
}
