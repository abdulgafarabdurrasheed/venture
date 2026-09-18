function normalizeHackatimeNames(value) {
  if (Array.isArray(value)) {
    return value.map((name) => String(name).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((name) => String(name).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function formatHackatimeTrackingSuffix(hackatimeNames) {
  const names = normalizeHackatimeNames(hackatimeNames);
  if (names.length > 0) {
    return `- Hackatime: ${names.join(", ")}`;
  }
  return "- Journaling used";
}

function formatJustificationDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function formatIsoDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatHours(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "";
}

export function buildYswsOverrideHoursJustification({
  hackatimeUserId = null,
  hackatimeNames = null,
  rawHours = null,
  approvedHours = null,
  startDate = null,
  endDate = null,
  usedJournaling = false,
  deflationJustification = null,
  projectPageUrl = null,
  journalingUrl = null,
} = {}) {
  const projects = normalizeHackatimeNames(hackatimeNames);
  const projectLines = projects.length > 0 ? projects.map((name) => `- ${name}`) : ["-"];

  return [
    "[HACKATIME]",
    `User Hackatime ID: ${String(hackatimeUserId || "").trim()}`,
    "",
    "Projects:",
    ...projectLines,
    "",
    `Raw Hackatime hours (BEFORE reviewer deflation): ${formatHours(rawHours)}`,
    "",
    `Hours approved (AFTER reviewer deflation): ${formatHours(approvedHours)}`,
    "",
    "Time period:",
    `- Start: ${formatIsoDate(startDate)}`,
    `- End: ${formatIsoDate(endDate)}`,
    "",
    "[REVIEW]",
    "",
    "Specific Technical Features:",
    "",
    `Deflation Justification: ${String(deflationJustification || "").trim()}`,
    "",
    `Alternate Tracking Method: ${usedJournaling ? "journaling" : ""}`,
    "",
    "Additional Justification:",
    "",
    "[LINKS]",
    "",
    `Project Page: ${String(projectPageUrl || "").trim()}`,
    "",
    `Journaling (password required): ${String(journalingUrl || "").trim()}`,
  ].join("\n");
}

export function buildDefaultJustificationTemplate({
  approvedHours = null,
  totalHours = null,
  reductionHours = null,
  reviewerName = null,
  shippingDate = null,
  hackatimeNames = null,
  reshipUpdate = null,
} = {}) {
  const approved = approvedHours != null ? Number(approvedHours).toFixed(2) : "<tot_approved_hours>";
  const total = totalHours != null ? Number(totalHours).toFixed(2) : "<tot_logged_hours>";
  const reduction = reductionHours != null ? Number(reductionHours).toFixed(2) : "<red_hours>";
  const reviewer = reviewerName || "<reviewer_name>";
  const shipped = formatJustificationDate(shippingDate) || "<shipping_date>";
  const update = String(reshipUpdate || "").trim();

  const lines = [
    "The project includes [leave empty, I'll manually enter this].",
    `The commit history shows [leave empty, I'll manually enter this] commits. ${approved} hours is consistent with this scope.`,
    `Hackatime project user analyzed from 05/28/26 to ${shipped} shows ${total} hours tracked. The heartbeat pattern is consistent with active development.`,
    "",
    `Total hours approved (cumulative on this project): ${approved} h.`,
    `Total logged at review (Hackatime + journal): ${total} h.`,
    `Reduction from logged: ${reduction}h less approved than logged.`,
    `Project reviewed by ${reviewer}. Demo and repository looked solid, including heartbeats.`,
    formatHackatimeTrackingSuffix(hackatimeNames),
  ];

  if (update) {
    lines.push("", `The user, compared to the last ship, has added: ${update}`);
  }

  return lines.join("\n");
}
