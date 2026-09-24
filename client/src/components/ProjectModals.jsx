import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CDN_UPLOAD_HELP, normalizeHackClubCdnUrl } from "../utils/cdnLinks.js";
import { resolveStackAssetUrl } from "../utils/mediaUrls.js";
import {
  displayStatus,
  formatHours,
  formatHackatimeProjectLabel,
  formatReviewRecordMeta,
  getApprovedBankedHours,
  getLoggedHours,
  getProjectReviewFeedback,
  getReshipUpdateValidationError,
  getShipButtonLabel,
  getShipLockReason,
  getUnshippedHours,
  isHackClubCdnUrl,
  isReshipEligibleProject,
  isValidHttpUrl,
  MIN_RESHIP_UPDATE_LENGTH,
  reviewOutcomeLabel,
  shouldShowReviewerFeedback,
  sumHackatimeHoursForNames,
  toggleHackatimeName,
} from "../utils/projectHelpers.js";
import "./ProjectModals.css";

function ModalShell({ title, onClose, children, className = "" }) {
  return createPortal(
    <div className="project-modal__overlay" role="presentation" onClick={onClose}>
      <section
        className={`project-modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="project-modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="project-modal__title">{title}</h2>
        {children}
      </section>
    </div>,
    document.body
  );
}

function ProjectReviewerFeedback({ project }) {
  const records = getProjectReviewFeedback(project);
  if (records.length === 0) return null;

  return (
    <section className="project-modal__reviewer-feedback" aria-label="Reviewer feedback history">
      <h3 className="project-modal__reviewer-feedback-title">Reviewer feedback</h3>
      <div className="project-modal__reviewer-feedback-scroll">
        {records.map((record) => (
          <article className="project-modal__reviewer-feedback-item" key={record.id}>
            <header className="project-modal__reviewer-feedback-item-header">
              <strong className={`project-modal__reviewer-feedback-outcome is-${record.outcome}`}>
                {reviewOutcomeLabel(record.outcome)}
              </strong>
              <small className="project-modal__reviewer-feedback-meta">{formatReviewRecordMeta(record)}</small>
            </header>
            {record.feedback ? <p className="project-modal__reviewer-feedback-body">{record.feedback}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function ProjectDetailModal({ project, onClose, onEdit, onJournal, onDelete, onShip }) {
  const shipLockReason = getShipLockReason(project);
  const isReship = isReshipEligibleProject(project);
  const [reshipUpdate, setReshipUpdate] = useState("");
  const [reshipUpdateError, setReshipUpdateError] = useState("");

  function handleShip() {
    if (isReship) {
      const validationError = getReshipUpdateValidationError(reshipUpdate);
      if (validationError) {
        setReshipUpdateError(validationError);
        return;
      }
    }
    setReshipUpdateError("");
    onShip(isReship ? reshipUpdate.trim() : undefined);
  }

  return (
    <ModalShell title={project.name || "Project"} onClose={onClose}>
      <p className="project-modal__description">{project.description || "No description yet."}</p>

      {project.imageUrl ? (
        <img
          className="project-modal__image"
          src={resolveStackAssetUrl(project.imageUrl) || project.imageUrl}
          alt=""
        />
      ) : null}

      <dl className="project-modal__meta">
        <div>
          <dt>Type</dt>
          <dd>{project.projectType || "—"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{displayStatus(project)}</dd>
        </div>
        <div>
          <dt>Hours logged (combined)</dt>
          <dd>{formatHours(getLoggedHours(project))}</dd>
        </div>
        <div>
          <dt>Hours approved</dt>
          <dd>{formatHours(getApprovedBankedHours(project))}</dd>
        </div>
        <div>
          <dt>Unshipped hours</dt>
          <dd>{formatHours(getUnshippedHours(project))}</dd>
        </div>
        <div>
          <dt>Journal hours</dt>
          <dd>{formatHours(project.journalHours)}</dd>
        </div>
        <div>
          <dt>Hackatime hours</dt>
          <dd>{formatHours(project.hackatimeHours)}</dd>
        </div>
        <div>
          <dt>Hackatime projects</dt>
          <dd>{(project.hackatimeNames || []).join(", ") || "—"}</dd>
        </div>
      </dl>

      {project.playableUrl ? (
        <a className="project-modal__link" href={project.playableUrl} target="_blank" rel="noreferrer">
          Playable URL
        </a>
      ) : null}
      {project.codeUrl ? (
        <a className="project-modal__link" href={project.codeUrl} target="_blank" rel="noreferrer">
          Code URL
        </a>
      ) : null}

      {shouldShowReviewerFeedback(project) ? <ProjectReviewerFeedback project={project} /> : null}

      {isReship ? (
        <div className="project-modal__reship-update">
          <label htmlFor="reship-update">
            Please give a detailed update of your work compared to the previous ship (minimum{" "}
            {MIN_RESHIP_UPDATE_LENGTH} characters)
          </label>
          <textarea
            id="reship-update"
            value={reshipUpdate}
            minLength={MIN_RESHIP_UPDATE_LENGTH}
            onChange={(event) => {
              setReshipUpdate(event.target.value);
              if (reshipUpdateError) setReshipUpdateError("");
            }}
            required
          />
          {reshipUpdateError ? <p className="project-modal__ship-lock">{reshipUpdateError}</p> : null}
        </div>
      ) : null}

      <div className="project-modal__actions">
        <button type="button" onClick={onEdit}>
          Edit
        </button>
        <button type="button" onClick={onJournal}>
          Journal
        </button>
        <button
          type="button"
          disabled={Boolean(shipLockReason)}
          title={shipLockReason || "Ready to ship"}
          onClick={handleShip}
        >
          {getShipButtonLabel()}
        </button>
        <button
          type="button"
          className="project-modal__danger"
          disabled={project.shipped}
          title={project.shipped ? "Cannot delete shipped projects" : "Delete project"}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
      {shipLockReason ? <p className="project-modal__ship-lock">{shipLockReason}</p> : null}
    </ModalShell>
  );
}

export function ProjectFormModal({
  project,
  hackatimeAvailable,
  hackatimeConnected,
  hackatimeProjects,
  stackLaunched,
  onChange,
  onClose,
  onSubmit,
}) {
  const [allProjects, setAllProjects] = useState([]);
  const [imageLinkError, setImageLinkError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/projects", { credentials: "include" });
        const data = await response.json();
        if (!cancelled) setAllProjects(data.projects || []);
      } catch {
        if (!cancelled) setAllProjects([]);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const usedHackatimeNames = new Set(
    allProjects
      .filter((entry) => entry.shipped && entry.id !== project.id)
      .flatMap((entry) => entry.hackatimeNames || [])
  );

  const previewJournalHours = Number(project.journalHours ?? project.totalHours ?? 0);
  const previewHackatimeHours = sumHackatimeHoursForNames(hackatimeProjects, project.hackatimeNames);
  const previewCombinedHours = Number((previewJournalHours + previewHackatimeHours).toFixed(2));

  function applyProjectImageLink(rawUrl) {
    const normalized = normalizeHackClubCdnUrl(rawUrl);
    if (!normalized) {
      setImageLinkError("Paste a Hack Club CDN link from #cdn on Slack.");
      return;
    }
    setImageLinkError("");
    onChange("imageUrl", normalized);
  }

  return (
    <ModalShell
      title={project.id ? "Edit Project" : "New Project"}
      onClose={onClose}
      className="project-modal--form"
    >
      <form
        className="project-modal__form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label>
          Project name
          <input value={project.name || ""} onChange={(event) => onChange("name", event.target.value)} required />
        </label>

        <label>
          Description
          <textarea
            value={project.description || ""}
            onChange={(event) => onChange("description", event.target.value)}
            required
          />
        </label>

        <label>
          Type of project
          <select value={project.projectType || "software"} onChange={(event) => onChange("projectType", event.target.value)}>
            <option value="software">Software</option>
            <option value="hardware">Hardware</option>
            <option value="art" disabled title="Coming soon...">
              Art (Coming soon...)
            </option>
          </select>
        </label>

        <label>
          Playable URL (required before shipping)
          <input
            type="url"
            value={project.playableUrl || ""}
            onChange={(event) => onChange("playableUrl", event.target.value)}
          />
        </label>

        <label>
          Code URL (required before shipping)
          <input
            type="url"
            value={project.codeUrl || ""}
            onChange={(event) => onChange("codeUrl", event.target.value)}
          />
        </label>

        <div className="project-modal__hours-preview" aria-live="polite">
          <p>
            <strong>{formatHours(previewCombinedHours)} h</strong> on this project
            {previewCombinedHours > 0 ? (
              <span className="project-modal__hours-preview-detail">
                {" "}
                (journal {formatHours(previewJournalHours)} + Hackatime {formatHours(previewHackatimeHours)})
              </span>
            ) : null}
          </p>
          {previewCombinedHours <= 0 ? (
            <p className="project-modal__hours-preview-hint">
              Hours come from journal entries (after you save this project) and from Hackatime projects you link below.
              Connect Hackatime, check the matching project(s), then save.
            </p>
          ) : null}
        </div>

        <div className="project-modal__image-field">
          <span>Project image (required before shipping)</span>
          <p className="project-modal__cdn-upload-hint">{CDN_UPLOAD_HELP}</p>
          <div className="project-modal__cdn-link-row">
            <input
              type="url"
              className="project-modal__cdn-link-input"
              value={project.imageUrl || ""}
              onChange={(event) => {
                onChange("imageUrl", event.target.value);
                setImageLinkError("");
              }}
              onBlur={(event) => applyProjectImageLink(event.target.value)}
              placeholder="https://cdn.hackclub.com/…"
            />
            {project.imageUrl ? (
              <button type="button" className="project-modal__danger" onClick={() => onChange("imageUrl", "")}>
                Remove
              </button>
            ) : null}
          </div>
          {imageLinkError ? <p className="project-modal__image-error">{imageLinkError}</p> : null}
          {isHackClubCdnUrl(project.imageUrl) ? (
            <img className="project-modal__image-preview" src={project.imageUrl} alt="" />
          ) : null}
        </div>

        <fieldset
          disabled={!hackatimeConnected}
          className={hackatimeConnected ? "project-modal__hackatime" : "project-modal__hackatime-disabled"}
        >
          <legend>Hackatime projects</legend>
          {!hackatimeAvailable ? (
            <p>Hackatime OAuth is not configured on this server.</p>
          ) : !hackatimeConnected ? (
            <p>
              Connect Hackatime on your next login, or{" "}
              <a href="/api/auth/hackatime/login?returnTo=/projects">connect now</a>.
            </p>
          ) : hackatimeProjects.length === 0 ? (
            <p>No Hackatime projects found on your account yet.</p>
          ) : (
            <div className="project-modal__hackatime-list">
              {hackatimeProjects.map((entry) => {
                const checked = (project.hackatimeNames || []).includes(entry.name);
                const usedElsewhere = usedHackatimeNames.has(entry.name) && !checked;
                return (
                  <label key={entry.name} className={usedElsewhere ? "is-disabled" : undefined}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={usedElsewhere}
                      onChange={() => onChange("hackatimeNames", toggleHackatimeName(project.hackatimeNames, entry.name))}
                    />
                    <span>
                      {entry.name} ({formatHackatimeProjectLabel(entry, stackLaunched)})
                      {usedElsewhere ? " — already used" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {previewHackatimeHours > 0 ? (
            <p className="project-modal__hackatime-summary">
              Selected Hackatime: {formatHours(previewHackatimeHours)} h (since Venture launch)
            </p>
          ) : hackatimeConnected && hackatimeProjects.length > 0 ? (
            <p className="project-modal__hackatime-summary project-modal__hackatime-summary--muted">
              {stackLaunched
                ? "Select at least one Hackatime project above to count your coding time."
                : "You can link Hackatime projects now. Hours count toward Venture starting June 5."}
            </p>
          ) : null}
        </fieldset>

        <button type="submit" className="project-modal__submit">
          Save Project
        </button>
      </form>
    </ModalShell>
  );
}

export function validateProjectForm(project, projects) {
  if (!project.name?.trim()) return "Project name is required.";
  if (!project.description?.trim()) return "Description is required.";
  if (!project.projectType) return "Project type is required.";

  const duplicate = projects.some(
    (entry) =>
      entry.id !== project.id && entry.name?.trim().toLowerCase() === project.name.trim().toLowerCase()
  );
  if (duplicate) return "You already have a project with that name.";

  if (project.codeUrl && !isValidHttpUrl(project.codeUrl)) {
    return "Code URL must be a valid URL (e.g., https://github.com/...).";
  }
  if (project.playableUrl && !isValidHttpUrl(project.playableUrl)) {
    return "Playable URL must be a valid URL.";
  }
  if (project.imageUrl && !isHackClubCdnUrl(project.imageUrl)) {
    return "Project image must be a Hack Club CDN link from #cdn on Slack.";
  }

  if (project.shipped && (project.hackatimeNames || []).length > 0) {
    const shippedHackatimeProjects = projects
      .filter((entry) => entry.shipped && entry.id !== project.id)
      .flatMap((entry) => entry.hackatimeNames || []);
    const duplicateHackatime = (project.hackatimeNames || []).find((name) =>
      shippedHackatimeProjects.includes(name)
    );
    if (duplicateHackatime) {
      return `"${duplicateHackatime}" is already linked to another shipped project.`;
    }
  }

  return "";
}
