import { useState } from "react";
import { apiFetch } from "../api/client.js";
import { formatHours } from "../utils/projectHelpers.js";
import "./HoursReductionWarning.css";

function buildProjectsLine(warnings) {
  const projectLines = warnings.map(
    (warning) => `${warning.projectName} - hours reduced: ${formatHours(warning.hoursReduced)}`
  );
  return `Projects affected: ${projectLines.join("; ")}.`;
}

export function HoursReductionWarning({ warnings, onAcknowledged }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gotIt, setGotIt] = useState(false);
  const [snapshot, setSnapshot] = useState(null);

  const displayWarnings = snapshot ?? warnings;
  if (!displayWarnings?.length) return null;

  function handleReadMore() {
    if (expanded) return;
    setSnapshot(warnings);
    setExpanded(true);
  }

  async function handleDismiss() {
    if (!gotIt || busy) return;
    setBusy(true);
    try {
      const response = await apiFetch("/api/projects/hours-warnings/acknowledge", {
        method: "POST",
        body: JSON.stringify({ feedbackIds: displayWarnings.map((warning) => warning.id) }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not dismiss hours warning.");
      }
      onAcknowledged?.();
    } catch {
      // Keep the popup visible until acknowledge succeeds.
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="hours-reduction-warning" role="alert" aria-live="polite">
      {!expanded ? (
        <button type="button" className="hours-reduction-warning__toggle" onClick={handleReadMore}>
          hours warning - read more
        </button>
      ) : (
        <div className="hours-reduction-warning__body">
          <p>
            an admin reduced your hours and the connected coins after a quality check. This process can&apos;t be
            undone. {buildProjectsLine(displayWarnings)}
          </p>
          {displayWarnings.map((warning) =>
            warning.reason ? (
              <p className="hours-reduction-warning__reason" key={warning.id}>
                REASON: {warning.reason}
              </p>
            ) : null
          )}
          <label className="hours-reduction-warning__ack">
            <input type="checkbox" checked={gotIt} onChange={(event) => setGotIt(event.target.checked)} />
            <span>Got it</span>
          </label>
          <button
            type="button"
            className="hours-reduction-warning__dismiss"
            disabled={!gotIt || busy}
            onClick={handleDismiss}
          >
            {busy ? "Saving…" : "Dismiss"}
          </button>
        </div>
      )}
    </aside>
  );
}
