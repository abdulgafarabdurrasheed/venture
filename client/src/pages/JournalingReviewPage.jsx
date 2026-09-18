import { useEffect, useState } from "react";

import { apiFetch } from "../api/client.js";
import { JournalDescription } from "../components/JournalDescription.jsx";
import { readJsonResponse } from "../utils/fetchJson.js";
import { resolveStackAssetUrl } from "../utils/mediaUrls.js";
import "./AdminReviewPage.css";
import "./JournalingReviewPage.css";

const JOURNALING_API = "/api/platform/journaling";
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const MARKDOWN_LINK_RE = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;

function journalLinks(description) {
  const text = String(description || "");
  const links = new Set();
  let match;

  const markdownRe = new RegExp(MARKDOWN_LINK_RE.source, "gi");
  while ((match = markdownRe.exec(text)) !== null) {
    links.add(match[1]);
  }

  const urlRe = new RegExp(URL_RE.source, "gi");
  while ((match = urlRe.exec(text)) !== null) {
    links.add(match[0].replace(/[.,;:!?]+$/, ""));
  }

  return [...links];
}

function formatEntryDate(entry) {
  const value = entry.timeDone || entry.createdAt;
  return value ? new Date(value).toLocaleString() : "Date unavailable";
}

function ProjectImage({ src, alt }) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveStackAssetUrl(src);
  if (!resolved || failed) {
    return <span className="admin-review-image-fallback">Project image unavailable</span>;
  }
  return <img src={resolved} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

function JournalEntries({ entries }) {
  return entries.map((entry) => {
    const links = journalLinks(entry.description);
    return (
      <article className="admin-review-journal-entry journaling-review-entry" key={entry.id}>
        <header>
          <strong>{formatEntryDate(entry)}</strong>
          <span>{Number(entry.hoursWorked || 0).toFixed(2)}h</span>
        </header>
        <JournalDescription
          text={entry.description}
          className="admin-review-journal-description"
          mediaClassName="admin-review-media-item"
        />
        {entry.toolsUsed?.length ? <small>Tools: {entry.toolsUsed.join(", ")}</small> : null}
        {links.length > 0 ? (
          <div className="journaling-review-links" aria-label="Journal links">
            {links.map((link, index) => (
              <a href={link} target="_blank" rel="noreferrer" key={link}>
                Link {index + 1}
              </a>
            ))}
          </div>
        ) : null}
      </article>
    );
  });
}

export function JournalingReviewPage({ projectId, token }) {
  const [access, setAccess] = useState({ loading: true, configured: true, unlocked: false });
  const [password, setPassword] = useState("");
  const [project, setProject] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isGeneralPage = !projectId && !token;
  const projectApi = isGeneralPage
    ? JOURNALING_API
    : `${JOURNALING_API}/projects/${encodeURIComponent(projectId || "")}/${encodeURIComponent(token || "")}`;
  const selectedProject = projects.find((item) => String(item.id) === String(selectedProjectId)) || null;

  useEffect(() => {
    loadAccess();
  }, [projectId, token]);

  useEffect(() => {
    if (access.unlocked) loadJournals();
  }, [access.unlocked, projectId, token]);

  async function loadAccess() {
    setError("");
    try {
      const response = await fetch(`${projectApi}/status`, { credentials: "include" });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "Could not check journal access.");
      setAccess({ loading: false, configured: Boolean(data.configured), unlocked: Boolean(data.unlocked) });
    } catch (err) {
      setAccess((current) => ({ ...current, loading: false }));
      setError(err.message);
    }
  }

  async function loadJournals() {
    setError("");
    try {
      const response = await fetch(isGeneralPage ? `${projectApi}/projects` : projectApi, {
        credentials: "include",
      });
      const data = await readJsonResponse(response);
      if (response.status === 401) {
        setAccess((current) => ({ ...current, unlocked: false }));
        return;
      }
      if (!response.ok) throw new Error(data.error || "Could not load journal entries.");
      if (isGeneralPage) {
        setProjects(Array.isArray(data.projects) ? data.projects : []);
      } else {
        setProject(data.project || null);
        setEntries(Array.isArray(data.journalEntries) ? data.journalEntries : []);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function unlock(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await apiFetch(`${projectApi}/unlock`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "Incorrect password.");
      setPassword("");
      setAccess((current) => ({ ...current, unlocked: true }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (access.loading) {
    return (
      <main className="admin-review-page">
        <section className="admin-review-container">
          <p className="admin-review-state">Loading journal access…</p>
        </section>
      </main>
    );
  }

  if (!access.configured || !access.unlocked) {
    return (
      <main className="admin-review-page journaling-review-page">
        <section className="journaling-gate" aria-labelledby="journaling-gate-title">
          <h1 id="journaling-gate-title">{isGeneralPage ? "Journaling Records" : "Project Journaling"}</h1>
          {access.configured ? (
            <>
              <p>Enter the shared journaling password to view these records.</p>
              <form onSubmit={unlock}>
                <label htmlFor="journaling-password">Password</label>
                <input
                  id="journaling-password"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  required
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button type="submit" disabled={submitting}>
                  {submitting ? "Checking…" : "Open journals"}
                </button>
              </form>
            </>
          ) : (
            <p>Journaling access is not configured.</p>
          )}
          {error ? <p className="journaling-gate-error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-review-page journaling-review-page">
      <section className="admin-review-container admin-review-detail">
        <header className="admin-review-header">
          <h1>
            {isGeneralPage
              ? selectedProject?.name || "Journaling Projects"
              : project?.name || "Project Journaling"}
          </h1>
          <p>
            External journal review ·{" "}
            {isGeneralPage
              ? selectedProject
                ? `${selectedProject.journalEntries.length} ${
                    selectedProject.journalEntries.length === 1 ? "record" : "records"
                  }`
                : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`
              : `${entries.length} ${entries.length === 1 ? "record" : "records"}`}
          </p>
        </header>

        {error ? <p className="admin-review-state admin-review-state--error">{error}</p> : null}
        {!isGeneralPage && !project && !error ? <p className="admin-review-state">Loading journal records…</p> : null}

        {isGeneralPage ? (
          selectedProject ? (
            <>
              <button
                className="admin-review-back journaling-review-back"
                type="button"
                onClick={() => setSelectedProjectId(null)}
              >
                ← Back to journaling projects
              </button>
              <section className="admin-review-panel">
                <h2>Journal Entries ({selectedProject.journalEntries.length})</h2>
                <JournalEntries entries={selectedProject.journalEntries} />
              </section>
            </>
          ) : (
            <div className="admin-review-grid">
              {projects.length === 0 && !error ? (
                <p className="admin-review-state">No shipped journal projects found.</p>
              ) : null}
              {projects.map((item) => (
                <button
                  className="admin-review-card journaling-project-card"
                  type="button"
                  key={item.id}
                  onClick={() => setSelectedProjectId(item.id)}
                >
                  <div className="admin-review-thumb">
                    <ProjectImage src={item.imageUrl} alt={`${item.name} project`} />
                  </div>
                  <div className="admin-review-card-content">
                    <div className="admin-review-card-header">
                      <h2>{item.name}</h2>
                      <span>{item.journalEntries.length}</span>
                    </div>
                    <p>
                      {item.journalEntries.length} {item.journalEntries.length === 1 ? "journal entry" : "journal entries"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : project ? (
          <section className="admin-review-panel">
            <h2>Journal Entries ({entries.length})</h2>
            {entries.length === 0 ? <p>No journal entries are attached to this project.</p> : null}
            <JournalEntries entries={entries} />
          </section>
        ) : null}
      </section>
    </main>
  );
}
