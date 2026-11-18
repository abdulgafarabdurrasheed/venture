import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/client.js";
import "./AdminShopPage.css";
import "./AdminProjectDeletionsPage.css";

function formatDate(value) {
  if (!value) return "Unknown date";
  return new Date(value).toLocaleString();
}

function formatCoins(value) {
  return `${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} coins`;
}

function formatHours(value) {
  return `${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} hours`;
}

function safeProjectUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function AdminProjectDeletionsPage() {
  const [records, setRecords] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [archive, setArchive] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const detailsRequestId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/api/admin/project-deletions", { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load project deletion history.");
      setRecords(Array.isArray(data.records) ? data.records : []);
    } catch (err) {
      setError(err.message || "Failed to load project deletion history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  async function toggleArchive(recordId) {
    if (expandedId === recordId) {
      detailsRequestId.current += 1;
      setExpandedId(null);
      setArchive(null);
      setDetailsError("");
      return;
    }

    setExpandedId(recordId);
    setArchive(null);
    setDetailsError("");
    setDetailsLoading(true);
    const requestId = ++detailsRequestId.current;
    try {
      const response = await apiFetch(`/api/admin/project-deletions/${recordId}`, { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load the deletion snapshot.");
      if (detailsRequestId.current === requestId) setArchive(data.record);
    } catch (err) {
      if (detailsRequestId.current === requestId) {
        setDetailsError(err.message || "Failed to load the deletion snapshot.");
      }
    } finally {
      if (detailsRequestId.current === requestId) setDetailsLoading(false);
    }
  }

  return (
    <main className="admin-shop-page" aria-label="Deleted project history">
      <section className="admin-shop-content">
        <a className="admin-shop-back" href="/admin">← Back to admin</a>
        <h1>Deleted project history</h1>
        <p className="admin-shop-pricing-note">
          Deletion reasons, coin clawbacks, balance changes, and external cleanup status are retained here for
          superadmins.
        </p>
        <div className="admin-shop-table-header">
          <span>{records.length} recent deletions</span>
          <div className="admin-shop-actions">
            <button type="button" onClick={loadRecords} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {error ? <p className="admin-shop-form-error">{error}</p> : null}
        {loading && records.length === 0 ? <p>Loading deletion history…</p> : null}
        {!loading && !error && records.length === 0 ? <p>No project deletions have been recorded.</p> : null}
        {records.length > 0 ? (
          <div className="admin-shop-table-wrap">
            <table className="admin-shop-table">
              <thead>
                <tr>
                  <th>Deleted</th>
                  <th>Project</th>
                  <th>Owner / Admin</th>
                  <th>Reason</th>
                  <th>Coin clawback</th>
                  <th>Balance before → after</th>
                  <th>Unrecovered amount</th>
                  <th>Airtable cleanup</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <Fragment key={record.id}>
                    <tr>
                      <td>{formatDate(record.deletedAt)}</td>
                      <td>
                        <strong>{record.projectName}</strong>
                        <br />
                        ID {record.projectId}
                        <br />
                        {record.archivedJournalCount} journal entr{record.archivedJournalCount === 1 ? "y" : "ies"} archived
                        <br />
                        <button type="button" onClick={() => toggleArchive(record.id)}>
                          {expandedId === record.id ? "Hide archive" : "View archive"}
                        </button>
                      </td>
                      <td>
                        Owner ID {record.projectOwnerId ?? "—"}
                        <br />
                        Deleted by ID {record.deletedByUserId ?? "—"}
                      </td>
                      <td>{record.reason}</td>
                      <td>{formatCoins(record.coinClawback)}</td>
                      <td>
                        {formatCoins(record.coinBalanceBefore)} → {formatCoins(record.coinBalanceAfter)}
                      </td>
                      <td>{formatCoins(record.coinShortfall)}</td>
                      <td>
                        {record.externalCleanupCompletedAt
                          ? `Complete · ${formatDate(record.externalCleanupCompletedAt)}`
                          : `Pending · ${record.externalCleanupAttempts} attempt(s)`}
                        {record.externalCleanupLastError ? <p>{record.externalCleanupLastError}</p> : null}
                      </td>
                    </tr>
                  {expandedId === record.id ? (
                    <tr>
                      <td colSpan={8}>
                        {detailsLoading ? <p>Loading archived project data…</p> : null}
                        {detailsError ? <p className="admin-shop-form-error">{detailsError}</p> : null}
                        {archive ? (
                          <div className="admin-project-deletions-archive">
                            <h3>{archive.project?.name || record.projectName}</h3>
                            <p>{archive.project?.description || "No project description was stored."}</p>
                            <div className="admin-project-deletions-archive__links">
                              {safeProjectUrl(archive.project?.code_url) ? (
                                <a href={safeProjectUrl(archive.project.code_url)} target="_blank" rel="noreferrer">Code</a>
                              ) : null}
                              {safeProjectUrl(archive.project?.playable_url) ? (
                                <a href={safeProjectUrl(archive.project.playable_url)} target="_blank" rel="noreferrer">Playable project</a>
                              ) : null}
                            </div>
                            <h4>Journal entries ({archive.journalEntries.length})</h4>
                            {archive.journalEntries.length ? archive.journalEntries.map((entry) => (
                              <article className="admin-project-deletions-archive__journal" key={entry.id}>
                                <strong>{formatDate(entry.time_done || entry.created_at)} · {formatHours(entry.hours_worked)}</strong>
                                <p>{entry.description || "No journal description."}</p>
                              </article>
                            )) : <p>No journal entries were stored for this project.</p>}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
