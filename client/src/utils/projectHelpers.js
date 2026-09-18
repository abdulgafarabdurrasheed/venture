import { isHackClubCdnUrl } from "./cdnLinks.js";
import { isShippingClosed } from "../constants/shipDeadlines.js";

export { isHackClubCdnUrl };

export const EMPTY_PROJECT = {
  name: "",
  description: "",
  projectType: "software",
  playableUrl: "",
  codeUrl: "",
  imageUrl: "",
  hackatimeNames: [],
};

export const EMPTY_JOURNAL_ENTRY = {
  timeDone: "",
  hoursWorked: "",
  description: "",
  toolsUsed: "",
};

export function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDatetimeLocalValue(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function journalEntryToForm(entry) {
  return {
    timeDone: toDatetimeLocalValue(entry.timeDone || entry.createdAt),
    hoursWorked: entry.hoursWorked != null ? String(entry.hoursWorked) : "",
    description: entry.description || "",
    toolsUsed: (entry.toolsUsed || []).join(", "),
  };
}

export function getProjectReviewFeedback(project) {
  let records = [];
  if (Array.isArray(project.reviewFeedback) && project.reviewFeedback.length > 0) {
    records = project.reviewFeedback;
  } else {
    const legacyFeedback = String(project.adminFeedback || "").trim();
    if (!legacyFeedback) return [];

    const loggedHours = Number(project.combinedHours ?? project.totalHours ?? 0);
    const approvedHours = Number(project.approvedHours ?? 0);

    records = [
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

  return records.filter((record) => record.outcome !== "hours-reduced");
}

export function shouldShowReviewerFeedback(project) {
  return getProjectReviewFeedback(project).length > 0;
}

export function reviewOutcomeLabel(outcome) {
  if (outcome === "approved") return "Approved";
  if (outcome === "hours-reduced") return "Hours reduced";
  if (outcome === "queue-removed") return "Removed from queue";
  if (outcome === "reship-rejected") return "Rejected (resubmit)";
  if (outcome === "blocked") return "Blocked";
  if (outcome === "rejected") return "Rejected";
  return "Review";
}

export function formatReviewRecordMeta(record) {
  const timestamp = record.createdAt
    ? new Date(record.createdAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unknown date";
  const hours = Number(record.hours ?? 0);
  const reductionHours = Number(record.reductionHours ?? 0);
  const parts = [timestamp];

  if (Number.isFinite(hours) && hours > 0) {
    if (record.outcome === "approved") {
      parts.push(`${formatHours(hours)} h approved`);
    } else if (record.outcome === "hours-reduced") {
      parts.push(`${formatHours(hours)} h total after reduction`);
    } else {
      parts.push(`${formatHours(hours)} h ship`);
    }
  }

  if (
    (record.outcome === "approved" || record.outcome === "hours-reduced") &&
    Number.isFinite(reductionHours) &&
    record.reductionHours != null &&
    reductionHours > 0
  ) {
    parts.push(`${formatHours(reductionHours)} h reduced`);
  }

  return parts.length > 1 ? parts.join(" · ") : timestamp;
}

export function isReshipEligibleProject(project) {
  return (
    (project.status === "approved" && project.reviewed) ||
    project.status === "reship-rejected"
  );
}

export const MIN_RESHIP_UPDATE_LENGTH = 80;

export function getReshipUpdateValidationError(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "Please give a detailed update of your work compared to the previous ship.";
  }
  if (trimmed.length < MIN_RESHIP_UPDATE_LENGTH) {
    return `Please give a detailed update of at least ${MIN_RESHIP_UPDATE_LENGTH} characters comparing your work to the previous ship.`;
  }
  return null;
}

export function getShipButtonLabel() {
  return "Ship It";
}

export function throwShipConfetti() {
  const canvas = document.createElement("canvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText = "position:fixed;top:0;left:0;pointer-events:none;z-index:9999";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  const pieces = [];
  const colors = ["#c08251", "#8b6239", "#f5e6c8", "#d6a47a", "#3d2914", "#edd9b8"];

  for (let i = 0; i < 50; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      vx: (Math.random() - 0.5) * 8,
      vy: Math.random() * 4 + 3,
      size: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.2,
    });
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;

    for (const piece of pieces) {
      piece.y += piece.vy;
      piece.x += piece.vx;
      piece.vy += 0.15;
      piece.rotation += piece.rotationSpeed;

      if (piece.y < canvas.height + 50) {
        active = true;
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.rotation);
        ctx.fillStyle = piece.color;
        ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size);
        ctx.restore();
      }
    }

    if (active) requestAnimationFrame(animate);
    else document.body.removeChild(canvas);
  }

  animate();
}

export function isValidHttpUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function displayStatus(project) {
  if (project.status === "approved") return "Approved";
  if (project.status === "rejected" || project.status === "reship-rejected") return "Rejected";
  if (project.status === "blocked") return "Blocked";
  if (project.status === "in-review" || project.status === "pending-reship") return "In Review";
  if (project.shipped) return "Shipped";
  if (project.status === "draft") return "Draft";
  return project.status || "Draft";
}

export function formatHours(value) {
  return Number(value ?? 0).toFixed(2);
}

export function getLoggedHours(project) {
  return Number(project.combinedHours ?? project.totalHours ?? project.journalHours ?? 0);
}

export function getApprovedBankedHours(project) {
  return Math.max(Number(project.approvedHours ?? 0), Number(project.pastApprovedHours ?? 0));
}

export function getPreviouslyShippedHours(project) {
  return Math.max(Number(project.lastShippedHours ?? 0), getApprovedBankedHours(project));
}

export function getUnshippedHours(project) {
  return Math.max(0, Number((getLoggedHours(project) - getPreviouslyShippedHours(project)).toFixed(2)));
}

const MIN_SHIP_LOGGED_HOURS = 1;

function hoursRequiredToShip(project) {
  if (isReshipEligibleProject(project)) {
    return getUnshippedHours(project);
  }
  return getLoggedHours(project);
}

export function getShipLockReason(project) {
  if (isShippingClosed()) {
    return "Shipping has closed for Off-Track.";
  }
  if (project.blocked) {
    return "This project has been blocked and cannot be shipped again.";
  }
  if (project.status === "in-review" || project.status === "pending-reship") {
    return "Project is currently in review.";
  }
  if (project.shipped && !isReshipEligibleProject(project)) {
    return "Project is already shipped.";
  }
  const missing = [];
  if (!project.playableUrl) missing.push("playable URL missing");
  if (!project.codeUrl) missing.push("code URL missing");
  if (!project.imageUrl) {
    missing.push("project image missing");
  } else if (!isHackClubCdnUrl(project.imageUrl)) {
    missing.push("project image must be a Hack Club CDN link");
  }
  if (hoursRequiredToShip(project) < MIN_SHIP_LOGGED_HOURS) {
    missing.push(
      isReshipEligibleProject(project)
        ? "at least 1 new hour must be logged before re-shipping"
        : "at least 1 hour of work must be logged before shipping"
    );
  }
  return missing.length ? `Locked: ${missing.join(", ")}.` : "";
}

export function formatHackatimeProjectLabel(entry, stackLaunched) {
  const stackHours = Number(entry.totalHours ?? 0);
  const allTimeHours = Number(entry.allTimeHours ?? entry.totalHours ?? 0);

  if (stackLaunched) {
    return `${formatHours(stackHours)} h`;
  }

  if (allTimeHours > 0) {
    return `${formatHours(allTimeHours)} h total · counts after Jun 5`;
  }

  return `${formatHours(0)} h until launch`;
}

export function sumHackatimeHoursForNames(hackatimeProjects, linkedNames) {
  const names = new Set(
    (Array.isArray(linkedNames) ? linkedNames : [])
      .map((name) => String(name).trim().toLowerCase())
      .filter(Boolean)
  );
  if (names.size === 0) return 0;

  let seconds = 0;
  for (const project of hackatimeProjects || []) {
    if (names.has(String(project.name).trim().toLowerCase())) {
      seconds += Number(project.totalSeconds ?? 0);
    }
  }

  return Number((seconds / 3600).toFixed(2));
}

export function toggleHackatimeName(currentNames, name) {
  const set = new Set(currentNames || []);
  if (set.has(name)) set.delete(name);
  else set.add(name);
  return [...set];
}
