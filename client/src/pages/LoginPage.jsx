import { useEffect, useMemo, useState } from "react";
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

export function LoginPage() {
  const [modeError, setModeError] = useState("");
  const params = new URLSearchParams(window.location.search);
  const returnTo = useMemo(() => normalizeReturnTo(params.get("returnTo")), [params]);
  const errorCode = params.get("error");
  const errorMessage = ERROR_MESSAGES[errorCode] || (errorCode ? "Login failed. Please try again." : "");

  useEffect(() => {
    if (errorCode) return;
    let active = true;

    fetch("/api/auth/mode", { credentials: "include" })
      .then(async (response) => {
        const mode = await response.json();
        if (!response.ok) throw new Error(mode.error || "Could not read login settings.");
        if (!active) return;

        if (mode.dev) {
          window.location.replace(returnTo);
          return;
        }
        if (mode.hackClub) {
          window.location.replace(`/api/auth/hackclub/login?returnTo=${encodeURIComponent(returnTo)}`);
          return;
        }

        setModeError("No login method is configured for this environment.");
      })
      .catch((error) => {
        if (active) setModeError(error.message || "Could not read login settings.");
      });

    return () => {
      active = false;
    };
  }, [errorCode, returnTo]);

  return (
    <PlatformShell title="Login">
      {errorMessage || modeError ? (
        <>
          <p className="platform-gate__error">{errorMessage || modeError}</p>
          <p>
            <a href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Try Hack Club login again</a>
          </p>
        </>
      ) : (
        <p>Checking sign-in options…</p>
      )}
    </PlatformShell>
  );
}
