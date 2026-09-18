import { apiFetch } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { useEffect, useMemo, useState } from "react";
import { JournalDescription } from "../components/JournalDescription.jsx";
import { COINS_PER_APPROVED_HOUR } from "../constants/coinRates.js";
import { readJsonResponse } from "../utils/fetchJson.js";
import { resolveStackAssetUrl } from "../utils/mediaUrls.js";
import { formatReviewRecordMeta } from "../utils/projectHelpers.js";
import "./AdminReviewPage.css";

function ReviewImage({ src, className, alt = "" }) {
  const resolved = resolveStackAssetUrl(src);
  const [failed, setFailed] = useState(false);

  if (!resolved || failed) {
    return <span className="admin-review-image-fallback">{alt || "Image could not be loaded"}</span>;
  }

  return (
    <img
      className={className}
      src={resolved}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function formatHours(value) {
  return Number(value ?? 0).toFixed(2);
}

function formatDate(value) {
  if (!value) return "Shipped (unknown date)";
  return `Shipped ${new Date(value).toLocaleDateString()}`;
}

function canFullAdmin(role) {
  return role === "admin" || role === "superadmin";
}

function slackJoeToolUrl(slackId) {
  if (!slackId || typeof slackId !== "string") return null;
  const id = slackId.trim();
  if (!id) return null;
  return `https://joe.fraud.hackclub.com/profile/${encodeURIComponent(id)}`;
}

function slackDisplay(user) {
  return user?.slug ? `@${user.slug}` : user?.email || "Unknown";
}

function clampApprovalHours(value, maxHours, allowAboveMax = false) {
  if (value === "") return "";
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return value;
  if (numeric < 0) return "0";
  if (!allowAboveMax && Number.isFinite(maxHours) && numeric > maxHours) return maxHours.toFixed(2);
  return value;
}

function combinedLoggedHours(project) {
  const journal = Number(project.journalHours ?? project.totalHours ?? 0);
  const hackatime = Number(project.hackatimeHours ?? 0);
  return Number(project.combinedHours ?? journal + hackatime);
}

function formatHackatimeProjectNames(names) {
  const list = (Array.isArray(names) ? names : []).map((name) => String(name).trim()).filter(Boolean);
  return list.length ? list.join(", ") : "—";
}

function getProjectReviewHistory(project) {
  if (Array.isArray(project.reviewFeedback) && project.reviewFeedback.length > 0) {
    return [...project.reviewFeedback].sort(
      (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
    );
  }

  const legacyFeedback = String(project.adminFeedback || "").trim();
  if (!legacyFeedback) return [];

  const loggedHours = Number(project.combinedHours ?? project.totalHours ?? 0);
  const approvedHours = Number(project.approvedHours ?? 0);

  return [
    {
      id: `legacy-${project.id}`,
      outcome: project.status || "rejected",
      feedback: legacyFeedback,
      hours: project.status === "approved" ? approvedHours : null,
      reductionHours:
        project.status === "approved" ? Math.max(0, Number((loggedHours - approvedHours).toFixed(2))) : null,
      createdAt: project.reviewedAt || project.updatedAt,
    },
  ];
}

function reviewOutcomeLabel(outcome) {
  if (outcome === "approved") return "Approved";
  if (outcome === "hours-reduced") return "Hours reduced";
  if (outcome === "queue-removed") return "Removed from queue";
  if (outcome === "reship-rejected") return "Rejected (resubmit)";
  if (outcome === "blocked") return "Blocked";
  if (outcome === "rejected") return "Rejected";
  return "Review";
}

/** True when "new hours to approve" is above the logged/pending caps shown on the review page. */
function approvalNeedsExceedAck(project, requestedNewHours) {
  if (!project || !Number.isFinite(requestedNewHours)) return false;
  const pendingCap = Number(project.pendingReviewHours ?? 0);
  const logged = combinedLoggedHours(project);
  const banked = Math.max(Number(project.pastApprovedHours ?? 0), Number(project.approvedHours ?? 0));
  const newTotal = banked + requestedNewHours;
  return (
    requestedNewHours > pendingCap + 1e-9 ||
    requestedNewHours > logged + 1e-9 ||
    newTotal > logged + 1e-9
  );
}

function approvalDeductsHours(project, requestedNewHours) {
  if (!project || !Number.isFinite(requestedNewHours)) return false;
  const logged = combinedLoggedHours(project);
  const banked = Math.max(Number(project.pastApprovedHours ?? 0), Number(project.approvedHours ?? 0));
  return banked + requestedNewHours < logged - 1e-9;
}

export function AdminReviewPage({ projectId }) {
  if (projectId) return <AdminReviewDetail projectId={projectId} />;
  return <AdminReviewIndex />;
}

function AdminReviewIndex() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [pendingProjects, setPendingProjects] = useState([]);
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("any");
  const [shipSort, setShipSort] = useState("oldest");
  const [status, setStatus] = useState("Loading review queue...");
  const [error, setError] = useState("");

  useEffect(() => {
    loadReviewProjects();
  }, [shipSort]);

  async function loadReviewProjects() {
    setStatus("Loading review queue...");
    setError("");
    try {
      const response = await apiFetch(`/api/admin/review/projects?shipSort=${encodeURIComponent(shipSort)}`, {
        credentials: "include",
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "Failed to load review projects.");
      setProjects(data.projects || []);
      setPendingProjects(data.pendingProjects || []);
      setStatus("");
    } catch (err) {
      setError(err.message);
      setStatus("");
    }
  }

  const shownProjects = activeTab === "pending" ? pendingProjects : projects;
  const filteredProjects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return shownProjects.filter((project) => {
      const matchesStatus = statusFilter === "any" || project.status === statusFilter;
      const userBlob = [project.user?.email, project.user?.slug].filter(Boolean).join(" ");
      const searchable = `${project.name} ${project.description || ""} ${userBlob}`.toLowerCase();
      return matchesStatus && (!needle || searchable.includes(needle));
    });
  }, [search, shownProjects, statusFilter]);

  const adminHomeHref = canFullAdmin(user?.role) ? "/admin" : "/projects";
  const adminHomeLabel = canFullAdmin(user?.role) ? "← Back to admin" : "← Back to platform";

  return (
    <main className="admin-review-page">
      <section className="admin-review-container">
        <a className="admin-review-back" href={adminHomeHref}>
          {adminHomeLabel}
        </a>
        <header className="admin-review-header">
          <h1>Project Reviews</h1>
          <p>Includes participant name, email, project links, hours, and shipped status.</p>
        </header>

        <input
          className="admin-review-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by project, user, email..."
        />

        <div className="admin-review-tabs-row">
          <div className="admin-review-tabs">
            <button className={activeTab === "all" ? "active" : ""} type="button" onClick={() => setActiveTab("all")}>
              All Projects ({projects.length})
            </button>
            <button className={activeTab === "pending" ? "active" : ""} type="button" onClick={() => setActiveTab("pending")}>
              Pending Review ({pendingProjects.length})
            </button>
          </div>
          <label>
            Ship date
            <select value={shipSort} onChange={(event) => setShipSort(event.target.value)}>
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
            </select>
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="any">Any status</option>
              <option value="draft">Draft</option>
              <option value="in-review">In review</option>
              <option value="pending-reship">Pending reship</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
        </div>

        {status ? <p className="admin-review-state">{status}</p> : null}
        {error ? <p className="admin-review-state admin-review-state--error">{error}</p> : null}
        {!status && !error && filteredProjects.length === 0 ? (
          <p className="admin-review-state">{activeTab === "pending" ? "All projects have been reviewed!" : "No projects yet."}</p>
        ) : null}

        <section className="admin-review-grid">
          {filteredProjects.map((project) => (
            <a className="admin-review-card" href={`/admin/review/project/${project.id}`} key={project.id}>
              <div className="admin-review-thumb">
                {project.imageUrl ? (
                  <ReviewImage src={project.imageUrl} className="" alt="" />
                ) : (
                  <span className="admin-review-image-fallback">Image could not be loaded</span>
                )}
              </div>
              <div className="admin-review-card-content">
                <div className="admin-review-card-header">
                  <h2>{project.name || "Untitled Project"}</h2>
                  <span>{project.status || "pending"}</span>
                </div>
                <p>{project.description || ""}</p>
                <div className="admin-review-tags">
                  {project.projectType ? <span>{project.projectType}</span> : null}
                  {project.shipped ? <span>Shipped</span> : null}
                  {project.reviewed ? <span>Reviewed</span> : null}
                  {project.fraudFlag ? <span className="admin-review-tag--fraud">Fraud flag</span> : null}
                </div>
                <footer>
                  <div className="admin-review-user">
                    <span>{(project.user?.email || "?")[0]?.toUpperCase() || "?"}</span>
                    {slackDisplay(project.user)}
                  </div>
                  <div className="admin-review-stats">
                    <strong>{formatHours(project.combinedHours ?? 0)}h</strong>
                    <small>{formatDate(project.shippedAt)}</small>
                  </div>
                </footer>
              </div>
            </a>
          ))}
        </section>
      </section>
    </main>
  );
}

function AdminReviewDetail({ projectId }) {
  const { user } = useAuth();
  const [project, setProject] = useState(null);
  const [journalEntries, setJournalEntries] = useState([]);
  const [approvedHours, setApprovedHours] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selectedAction, setSelectedAction] = useState("approve");
  const [status, setStatus] = useState("Loading project...");
  const [message, setMessage] = useState("");
  const [fraudSaving, setFraudSaving] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [exceedModalOpen, setExceedModalOpen] = useState(false);
  const [exceedAcknowledged, setExceedAcknowledged] = useState(false);
  const [reducedApprovedHours, setReducedApprovedHours] = useState("");
  const [reductionReason, setReductionReason] = useState("");
  const [reductionBusy, setReductionBusy] = useState(false);
  const [coinsConflictModal, setCoinsConflictModal] = useState(null);
  const [rejectingOrderId, setRejectingOrderId] = useState(null);

  useEffect(() => {
    loadProject();
  }, [projectId]);

  async function loadProject() {
    setStatus("Loading project...");
    setMessage("");
    try {
      const response = await apiFetch(`/api/admin/review/projects/${projectId}`, { credentials: "include" });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "Failed to load project.");
      setProject(data.project);
      setJournalEntries(data.journalEntries || []);
      setApprovedHours("");
      setReducedApprovedHours("");
      setReductionReason("");
      setStatus("");
    } catch (err) {
      setMessage(err.message);
      setStatus("");
    }
  }

  async function persistFraudFlag(nextChecked) {
    if (!project) return;
    setFraudSaving(true);
    setMessage("");
    try {
      const response = await apiFetch(`/api/admin/review/projects/${project.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fraudFlag: nextChecked }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "Could not save fraud flag.");
      setProject((current) => ({
        ...current,
        ...data.project,
        user: data.project?.user ?? current?.user,
        pendingReviewHours: data.project?.pendingReviewHours ?? current?.pendingReviewHours,
      }));
      setJournalEntries(data.journalEntries || []);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setFraudSaving(false);
    }
  }

  async function submitReview({ acknowledgeExceedLoggedHours = false } = {}) {
    if (!project) return;
    setMessage("");

    if ((selectedAction === "reject" || selectedAction === "removeFromQueue") && !feedback.trim()) {
      setMessage(
        selectedAction === "reject"
          ? "Rejection requires a written comment."
          : "Removing from the queue requires a written comment."
      );
      return;
    }

    const requestedApprovedHours = Number.parseFloat(approvedHours) || 0;
    if (
      selectedAction === "approve" &&
      approvalDeductsHours(project, requestedApprovedHours) &&
      !feedback.trim()
    ) {
      setMessage("Deducting logged hours requires a written deflation explanation.");
      return;
    }
    const needsExceedAck =
      selectedAction === "approve" && approvalNeedsExceedAck(project, requestedApprovedHours);
    const hasExceedAck = acknowledgeExceedLoggedHours || exceedAcknowledged;

    if (needsExceedAck && !hasExceedAck) {
      setExceedModalOpen(true);
      setMessage('Check the acknowledgment box (below the hours field or in this dialog), then submit again.');
      return;
    }

    const endpoint =
      selectedAction === "reject"
        ? `/api/admin/review/projects/${project.id}/reject`
        : selectedAction === "removeFromQueue"
          ? `/api/admin/review/projects/${project.id}/remove-from-queue`
          : `/api/admin/review/projects/${project.id}/approve`;
    const body =
      selectedAction === "reject" || selectedAction === "removeFromQueue"
        ? { feedback }
        : {
            approvedHours: requestedApprovedHours,
            feedback,
            ...(hasExceedAck && needsExceedAck ? { acknowledgeExceedLoggedHours: true } : {}),
          };

    try {
      const response = await apiFetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "Failed to submit review.");
      setExceedModalOpen(false);
      setExceedAcknowledged(false);
      const successMessage =
        selectedAction === "reject"
          ? "Project rejected. Pending queue hours were cleared and cannot be re-shipped for approval."
          : selectedAction === "removeFromQueue"
            ? "Project removed from the review queue. Pending hours can be re-shipped."
            : `Project approved. Awarded ${data.coinsEarned} coins.`;
      await loadProject();
      setMessage(successMessage);
    } catch (err) {
      setMessage(err.message);
    }
  }

  function confirmExceedAndSubmit() {
    if (!exceedAcknowledged) {
      setMessage("Check the acknowledgment box to approve above logged hours.");
      return;
    }
    setExceedModalOpen(false);
    submitReview({ acknowledgeExceedLoggedHours: true });
  }

  function handleApprovedHoursChange(rawValue) {
    if (!project) return;
    const pendingCap = Number(project.pendingReviewHours ?? 0);
    const next = clampApprovalHours(rawValue, pendingCap, true);
    setApprovedHours(next);
    const numeric = Number.parseFloat(next);
    if (Number.isFinite(numeric) && !approvalNeedsExceedAck(project, numeric)) {
      setExceedAcknowledged(false);
    }
  }

  function handleReducedApprovedHoursChange(rawValue) {
    if (!project) return;
    const currentApproved = Number(project.approvedHours ?? 0);
    const next = clampApprovalHours(rawValue, currentApproved, true);
    setReducedApprovedHours(next);
  }

  async function submitHoursReduction({ skipConfirm = false } = {}) {
    if (!project) return;
    setMessage("");

    const newApprovedHours = Number.parseFloat(reducedApprovedHours);
    const currentApproved = Number(project.approvedHours ?? 0);
    if (!Number.isFinite(newApprovedHours)) {
      setMessage("Enter the new total approved hours.");
      return;
    }
    if (newApprovedHours >= currentApproved) {
      setMessage(`New total must be less than the current ${formatHours(currentApproved)} h approved.`);
      return;
    }
    if (!reductionReason.trim()) {
      setMessage("A written reason is required when reducing approved hours.");
      return;
    }

    const hoursReduced = Number((currentApproved - newApprovedHours).toFixed(2));
    const coinsReduced = Number((hoursReduced * COINS_PER_APPROVED_HOUR).toFixed(2));
    if (!skipConfirm) {
      const ok = window.confirm(
        `Reduce approved hours from ${formatHours(currentApproved)} h to ${formatHours(newApprovedHours)} h? ` +
          `This removes ${formatHours(hoursReduced)} h and deducts ${formatHours(coinsReduced)} coins from the participant.`
      );
      if (!ok) return;
    }

    setReductionBusy(true);
    try {
      const response = await apiFetch(`/api/admin/review/projects/${project.id}/reduce-hours`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvedHours: newApprovedHours,
          feedback: reductionReason.trim(),
        }),
      });
      const data = await readJsonResponse(response);
      if (response.status === 409 && data.code === "INSUFFICIENT_COINS_FOR_REDUCTION") {
        setCoinsConflictModal({
          coinsShortfall: Number(data.coinsShortfall ?? 0),
          coinsToDeduct: Number(data.coinsToDeduct ?? coinsReduced),
          userCoins: Number(data.userCoins ?? 0),
          pendingOrders: Array.isArray(data.pendingOrders) ? data.pendingOrders : [],
        });
        return;
      }
      if (!response.ok) throw new Error(data.error || "Failed to reduce approved hours.");
      setCoinsConflictModal(null);
      setReducedApprovedHours("");
      setReductionReason("");
      await loadProject();
      setMessage(
        `Approved hours reduced to ${formatHours(data.approvedHours)} h. ` +
          `${formatHours(data.hoursReduced)} h removed (${formatHours(data.coinsDeducted ?? 0)} coins deducted).`
      );
    } catch (err) {
      setMessage(err.message);
    } finally {
      setReductionBusy(false);
    }
  }

  async function rejectParticipantOrder(orderId) {
    if (!project || !orderId) return;
    setRejectingOrderId(orderId);
    setMessage("");
    try {
      const response = await apiFetch(
        `/api/admin/review/projects/${project.id}/participant-orders/${orderId}/reject`,
        { method: "POST", credentials: "include" }
      );
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "Failed to reject order.");
      setCoinsConflictModal((current) =>
        current
          ? {
              ...current,
              userCoins: Number(data.userCoins ?? current.userCoins),
              pendingOrders: Array.isArray(data.pendingOrders) ? data.pendingOrders : current.pendingOrders,
            }
          : current
      );
    } catch (err) {
      setMessage(err.message);
    } finally {
      setRejectingOrderId(null);
    }
  }

  async function refreshParticipantOrders() {
    if (!project) return;
    try {
      const response = await apiFetch(`/api/admin/review/projects/${project.id}/participant-pending-orders`, {
        credentials: "include",
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "Failed to refresh pending orders.");
      setCoinsConflictModal((current) =>
        current
          ? {
              ...current,
              userCoins: Number(data.userCoins ?? current.userCoins),
              pendingOrders: Array.isArray(data.pendingOrders) ? data.pendingOrders : [],
            }
          : current
      );
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function closeCoinsConflictAndRetry() {
    setCoinsConflictModal(null);
    await loadProject();
    await submitHoursReduction({ skipConfirm: true });
  }

  async function deleteProjectPermanently() {
    if (!project) return;
    const ok = window.confirm(
      "Permanently delete this project and all of its journal entries from the database? This cannot be undone."
    );
    if (!ok) return;
    setDeleteBusy(true);
    setMessage("");
    try {
      const response = await apiFetch(`/api/admin/review/projects/${project.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "Failed to delete project.");
      window.location.href = "/admin/review";
    } catch (err) {
      setMessage(err.message);
      setDeleteBusy(false);
    }
  }

  if (status || !project) {
    return (
      <main className="admin-review-page">
        <section className="admin-review-container">
          <a className="admin-review-back" href="/admin/review">← Back to reviews</a>
          <p className={message ? "admin-review-state admin-review-state--error" : "admin-review-state"}>{message || status}</p>
        </section>
      </main>
    );
  }

  const isAlreadyReviewed = project.reviewed || project.status === "approved";
  const canReduceApprovedHours =
    Number(project.approvedHours ?? 0) > 0 && project.status !== "blocked" && !project.blocked;
  const joeUrl = slackJoeToolUrl(project.user?.slackId);
  const isSuperadmin = user?.role === "superadmin";
  const newHoursMax = Number(project.pendingReviewHours ?? 0);
  const newHoursPlaceholder = formatHours(newHoursMax);
  const approvedHoursNumber = Number.parseFloat(approvedHours);
  const awardPreview = Number.isFinite(approvedHoursNumber) ? approvedHoursNumber * COINS_PER_APPROVED_HOUR : 0;
  const needsExceedAckPreview =
    !isAlreadyReviewed &&
    selectedAction === "approve" &&
    Number.isFinite(approvedHoursNumber) &&
    approvalNeedsExceedAck(project, approvedHoursNumber);
  const deductsHoursPreview =
    !isAlreadyReviewed &&
    selectedAction === "approve" &&
    Number.isFinite(approvedHoursNumber) &&
    approvalDeductsHours(project, approvedHoursNumber);
  const loggedHoursPreview = combinedLoggedHours(project);
  const reviewHistory = getProjectReviewHistory(project);
  const reducedApprovedHoursNumber = Number.parseFloat(reducedApprovedHours);
  const currentApprovedHours = Number(project.approvedHours ?? 0);
  const reductionPreviewHours =
    Number.isFinite(reducedApprovedHoursNumber) && reducedApprovedHoursNumber < currentApprovedHours
      ? Number((currentApprovedHours - reducedApprovedHoursNumber).toFixed(2))
      : 0;
  const reductionPreviewCoins = reductionPreviewHours * COINS_PER_APPROVED_HOUR;

  return (
    <main className="admin-review-page">
      <section className="admin-review-container admin-review-detail">
        <a className="admin-review-back" href="/admin/review">
          ← Back to reviews
        </a>

        <header className="admin-review-header">
          <h1>{project.name}</h1>
          <p className="admin-review-participant-line">
            <strong className="admin-review-participant-email">{project.user?.email || "No email on file"}</strong>
            {project.user?.slug ? <span className="admin-review-participant-name"> · @{project.user.slug}</span> : null}
          </p>
        </header>

        {project.imageUrl ? (
          <ReviewImage src={project.imageUrl} className="admin-review-banner" alt="" />
        ) : (
          <div className="admin-review-banner admin-review-banner--empty">Screenshot unavailable</div>
        )}

        <section className="admin-review-quick-links" aria-label="Project links">
          {project.codeUrl ? (
            <a className="admin-review-tool-btn" href={project.codeUrl} target="_blank" rel="noreferrer">
              Code repo
            </a>
          ) : (
            <span className="admin-review-tool-btn admin-review-tool-btn--disabled">Code repo (missing)</span>
          )}
          {project.playableUrl ? (
            <a className="admin-review-tool-btn" href={project.playableUrl} target="_blank" rel="noreferrer">
              Live demo
            </a>
          ) : (
            <span className="admin-review-tool-btn admin-review-tool-btn--disabled">Live demo (missing)</span>
          )}
          {joeUrl ? (
            <a className="admin-review-tool-btn" href={joeUrl} target="_blank" rel="noreferrer">
              Joe
            </a>
          ) : (
            <span className="admin-review-tool-btn admin-review-tool-btn--disabled" title="Slack ID not set for this user">
              Joe (no Slack ID)
            </span>
          )}
        </section>

        {(project.shipKind === "reship" || project.status === "pending-reship") && project.reshipUpdate ? (
          <section className="admin-review-panel admin-review-reship-update" aria-label="Re-ship update">
            <h2>Re-ship update</h2>
            <p className="admin-review-reship-update-body">{project.reshipUpdate}</p>
          </section>
        ) : null}

        <label className="admin-review-fraud">
          <input
            type="checkbox"
            checked={Boolean(project.fraudFlag)}
            disabled={fraudSaving}
            onChange={(event) => persistFraudFlag(event.target.checked)}
          />
          <span>Fraud flag</span>
          {fraudSaving ? <small className="admin-review-fraud-saving">Saving…</small> : null}
        </label>

        <div className={`admin-review-time-row${reviewHistory.length > 0 ? " has-history" : ""}`}>
          <section className="admin-review-panel admin-review-time-panel">
            <h2>Time Tracking</h2>
            <div className="admin-review-hours-grid">
            <div>
              <span>Project</span>
              <strong>{project.name}</strong>
            </div>
            <div>
              <span>Raw Hours</span>
              <strong>{formatHours(project.combinedHours ?? 0)}</strong>
            </div>
            <div>
              <span>Previously banked</span>
              <strong>{formatHours(project.pastApprovedHours)} h</strong>
            </div>
            <div>
              <span>New hours</span>
              <strong>{newHoursPlaceholder} h</strong>
            </div>
            <div className="admin-review-hours-approve-cell">
              <span>New hours to approve</span>
              <input
                className="admin-review-hours-input"
                type="number"
                min="0"
                step="0.25"
                placeholder={newHoursPlaceholder}
                value={approvedHours}
                disabled={isAlreadyReviewed}
                onChange={(event) => handleApprovedHoursChange(event.target.value)}
              />
              <small>Only this approved amount awards coins: {formatHours(awardPreview)} coins</small>
              {needsExceedAckPreview ? (
                <>
                  <p className="admin-review-hours-warning">
                    Above logged hours ({formatHours(loggedHoursPreview)} h combined
                    {newHoursMax < loggedHoursPreview ? `, pending cap ${formatHours(newHoursMax)} h` : ""}).
                  </p>
                  <label className="admin-review-exceed-ack admin-review-exceed-ack--inline">
                    <input
                      type="checkbox"
                      checked={exceedAcknowledged}
                      disabled={isAlreadyReviewed}
                      onChange={(event) => setExceedAcknowledged(event.target.checked)}
                    />
                    <span>I&apos;m aware that I&apos;m giving more hours than the logged ones</span>
                  </label>
                </>
              ) : null}
            </div>
            <div>
              <span>Journal hours</span>
              <strong>{formatHours(project.journalHours)} h</strong>
            </div>
            <div>
              <span>Hackatime hours</span>
              <strong>{formatHours(project.hackatimeHours)} h</strong>
            </div>
            <div className="admin-review-hours-grid-hackatime-names">
              <span>Hackatime projects</span>
              <strong>{formatHackatimeProjectNames(project.hackatimeNames)}</strong>
            </div>
            <div>
              <span>Combined total</span>
              <strong>{formatHours((Number(project.journalHours || 0) + Number(project.hackatimeHours || 0)).toFixed(2))} h</strong>
            </div>
          </div>
          </section>

          {reviewHistory.length > 0 ? (
            <section className="admin-review-panel admin-review-history" aria-label="Review history">
              <h2>History ({reviewHistory.length})</h2>
              <div className="admin-review-history-list">
                {reviewHistory.map((record) => (
                  <article className={`admin-review-history-item is-${record.outcome}`} key={record.id}>
                    <header className="admin-review-history-item-header">
                      <strong className={`admin-review-history-outcome is-${record.outcome}`}>
                        {reviewOutcomeLabel(record.outcome)}
                      </strong>
                      <small className="admin-review-history-meta">{formatReviewRecordMeta(record)}</small>
                    </header>
                    {record.feedback ? <p className="admin-review-history-body">{record.feedback}</p> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {canReduceApprovedHours ? (
          <section className="admin-review-panel admin-review-reduce-hours" aria-label="Reduce approved hours">
            <h2>Reduce approved hours</h2>
            <p>
              Lower the cumulative approved hours for this project. Coins earned on this project and the participant&apos;s
              balance are updated immediately, including YSWS Airtable submissions after prior ships.
            </p>
            <div className="admin-review-reduce-hours-grid">
              <div>
                <span>Current approved</span>
                <strong>{formatHours(project.approvedHours)} h</strong>
              </div>
              <div>
                <span>Coins on project</span>
                <strong>{formatHours(project.coinsEarned ?? 0)} coins</strong>
              </div>
              <label className="admin-review-reduce-hours-field">
                <span>New total approved hours</span>
                <input
                  className="admin-review-hours-input"
                  type="number"
                  min="0"
                  max={Math.max(0, currentApprovedHours - 0.01)}
                  step="0.25"
                  placeholder={formatHours(Math.max(0, currentApprovedHours - 0.25))}
                  value={reducedApprovedHours}
                  disabled={reductionBusy}
                  onChange={(event) => handleReducedApprovedHoursChange(event.target.value)}
                />
              </label>
              <label className="admin-review-reduce-hours-field admin-review-reduce-hours-field--wide">
                <span>Reason (required)</span>
                <textarea
                  value={reductionReason}
                  disabled={reductionBusy}
                  onChange={(event) => setReductionReason(event.target.value)}
                  placeholder="Why are approved hours being reduced?"
                />
              </label>
            </div>
            {reductionPreviewHours > 0 ? (
              <p className="admin-review-reduce-hours-preview">
                Removes {formatHours(reductionPreviewHours)} h and deducts {formatHours(reductionPreviewCoins)} coins.
              </p>
            ) : null}
            <button
              className="admin-review-reduce-hours-submit"
              type="button"
              disabled={reductionBusy}
              onClick={submitHoursReduction}
            >
              {reductionBusy ? "Saving…" : "Apply hours reduction"}
            </button>
          </section>
        ) : null}

        <section className="admin-review-panel">
          <h2>Journal Entries ({journalEntries.length})</h2>
          {journalEntries.length === 0 ? (
            <p>No journal entries yet.</p>
          ) : (
            journalEntries.map((entry) => (
              <article className="admin-review-journal-entry" key={entry.id}>
                <strong>{entry.timeDone ? new Date(entry.timeDone).toLocaleString() : "N/A"} · {entry.hoursWorked}h</strong>
                <JournalDescription
                  text={entry.description}
                  className="admin-review-journal-description"
                  mediaClassName="admin-review-media-item"
                  staffReview
                />
                {entry.toolsUsed?.length ? <small>Tools: {entry.toolsUsed.join(", ")}</small> : null}
              </article>
            ))
          )}
        </section>

        <section className="admin-review-panel">
          {isAlreadyReviewed ? (
            <p>✓ This project has already been reviewed.</p>
          ) : (
            <>
              <p>
                Approve keeps the project in the shipped queue with approved status. Reject clears pending queue hours
                from the submission. Remove from queue also rejects the ship, but pending hours stay available to
                re-ship.
              </p>
              <div className="admin-review-actions">
                <button className={selectedAction === "approve" ? "approve active" : "approve"} type="button" onClick={() => setSelectedAction("approve")}>
                  ✓ Approve
                </button>
                <button className={selectedAction === "reject" ? "reject active" : "reject"} type="button" onClick={() => setSelectedAction("reject")}>
                  ✗ Reject
                </button>
                <button
                  className={selectedAction === "removeFromQueue" ? "remove-queue active" : "remove-queue"}
                  type="button"
                  onClick={() => setSelectedAction("removeFromQueue")}
                >
                  ↩ Remove from queue
                </button>
              </div>
              <label className="admin-review-feedback">
                {deductsHoursPreview
                  ? "Deflation explanation (required because logged hours are being deducted)"
                  : "Comment (optional for approve; required for reject or remove from queue)"}
                <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} />
              </label>
              <button className="admin-review-submit" type="button" onClick={() => submitReview()}>
                Submit Review
              </button>
            </>
          )}
          {message ? <p className="admin-review-state">{message}</p> : null}

          {isSuperadmin ? (
            <div className="admin-review-danger-zone">
              <h3>Superadmin</h3>
              <p>Remove this project row and related journal rows from Postgres.</p>
              <button
                className="admin-review-delete-btn"
                type="button"
                disabled={deleteBusy}
                onClick={deleteProjectPermanently}
              >
                {deleteBusy ? "Deleting…" : "Delete project from database"}
              </button>
            </div>
          ) : null}
        </section>
      </section>

      {exceedModalOpen ? (
        <div
          className="admin-review-modal-backdrop"
          role="presentation"
          onClick={() => setExceedModalOpen(false)}
        >
          <div
            className="admin-review-modal"
            role="dialog"
            aria-labelledby="admin-review-exceed-title"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="admin-review-exceed-title">Approve above logged hours?</h2>
            <p>
              You are approving <strong>{formatHours(approvedHoursNumber)} h</strong> new, but only{" "}
              <strong>{formatHours(project.combinedHours ?? 0)} h</strong> are logged (pending cap:{" "}
              {formatHours(newHoursMax)} h).
            </p>
            <label className="admin-review-exceed-ack">
              <input
                type="checkbox"
                checked={exceedAcknowledged}
                onChange={(event) => setExceedAcknowledged(event.target.checked)}
              />
              <span>I&apos;m aware that I&apos;m giving more hours than the logged ones</span>
            </label>
            <div className="admin-review-modal-actions">
              <button type="button" className="admin-review-tool-btn" onClick={() => setExceedModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-review-submit"
                disabled={!exceedAcknowledged}
                onClick={confirmExceedAndSubmit}
              >
                Approve anyway
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {coinsConflictModal ? (
        <div className="admin-review-modal-backdrop" role="presentation">
          <div
            className="admin-review-modal admin-review-modal--wide"
            role="dialog"
            aria-labelledby="admin-review-coins-conflict-title"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="admin-review-coins-conflict-title">Participant has already spent coins</h2>
            <p>
              This reduction needs <strong>{formatHours(coinsConflictModal.coinsToDeduct)} coins</strong>, but the
              participant only has <strong>{formatHours(coinsConflictModal.userCoins)} coins</strong> available (
              {formatHours(coinsConflictModal.coinsShortfall)} short). Hours were not changed. Reject pending shop
              orders below to refund coins, then retry the reduction.
            </p>

            <section className="admin-review-coins-orders" aria-label="Pending shop orders">
              <div className="admin-review-coins-orders-header">
                <h3>Pending orders</h3>
                <button type="button" className="admin-review-tool-btn" onClick={refreshParticipantOrders}>
                  Refresh list
                </button>
              </div>

              {coinsConflictModal.pendingOrders.length === 0 ? (
                <p className="admin-review-coins-orders-empty">
                  No pending orders to reject. The participant may have spent coins on fulfilled purchases that cannot
                  be refunded here.
                </p>
              ) : (
                <ul className="admin-review-coins-orders-list">
                  {coinsConflictModal.pendingOrders.map((order) => (
                    <li className="admin-review-coins-order" key={order.id}>
                      <div>
                        <strong>{order.itemName || "Shop item"}</strong>
                        <small>
                          Order #{order.id} · {formatHours(order.totalCoins ?? 0)} coins · qty {order.quantity ?? 1}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="admin-review-coins-order-reject"
                        disabled={rejectingOrderId != null}
                        onClick={() => rejectParticipantOrder(order.id)}
                      >
                        {rejectingOrderId === order.id ? "Rejecting…" : "Reject & refund"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="admin-review-modal-actions">
              <button type="button" className="admin-review-tool-btn" onClick={() => setCoinsConflictModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-review-submit"
                disabled={reductionBusy}
                onClick={closeCoinsConflictAndRetry}
              >
                {reductionBusy ? "Applying…" : "Refresh page & apply reduction"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
