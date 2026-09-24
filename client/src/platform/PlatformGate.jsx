import { useState } from "react";
import { apiFetch } from "../api/client.js";
import "../platform/platform.css";

export function PlatformGate({ onUnlocked }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await apiFetch("/api/platform/unlock", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || (response.status === 429 ? "Too many attempts. Try again later." : "Incorrect password."));
        return;
      }

      onUnlocked();
    } catch {
      setError("Could not verify password. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="platform-gate">
      <div className="platform-gate__card">
        <h1>Venture Platform</h1>
        <p className="platform-muted">This area is password-protected while we build it out.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="platform-password">Access password</label>
          <input
            id="platform-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          <button type="submit" disabled={submitting}>
            {submitting ? "Checking…" : "Enter platform"}
          </button>
        </form>
        {error ? <p className="platform-gate__error">{error}</p> : null}
        <p className="platform-muted" style={{ marginTop: "1rem" }}>
          <a href="/">← Back to landing page</a>
        </p>
      </div>
    </div>
  );
}
