import { MAX_PARTICIPANT_STARS, MAX_REVIEW_STARS_PER_PROJECT } from "./starConstants.js";

export const PUBLIC_PROJECT_EXCLUDED_STATUSES = Object.freeze([
  "rejected",
  "reship-rejected",
  "blocked",
  "banned",
  "archived",
]);

const excludedStatusSet = new Set(PUBLIC_PROJECT_EXCLUDED_STATUSES);

export function isPublicCommunityProject(project) {
  if (!project || project.blocked === true || project.fraud_flag === true) return false;
  return !excludedStatusSet.has(String(project.status || "").toLowerCase());
}

export function canAwardExploreStar({ ownerUserId, staffUserId, participantStars, alreadyAwarded }) {
  return staffUserId != null
    && ownerUserId != null
    && Number(ownerUserId) !== Number(staffUserId)
    && Number(participantStars || 0) < MAX_PARTICIPANT_STARS
    && !alreadyAwarded;
}

export function exploreStarEligibilityError({ project, staffUserId, participantStars, alreadyAwarded }) {
  if (!isPublicCommunityProject(project)) return "This project is not available in Explore.";
  if (Number(project.user_id) === Number(staffUserId)) return "You cannot star a project that you shipped.";
  if (alreadyAwarded) return "You have already awarded this project a star.";
  if (Number(participantStars || 0) >= MAX_PARTICIPANT_STARS) {
    return `This participant has reached the ${MAX_PARTICIPANT_STARS}-star limit.`;
  }
  return null;
}

export function maxReviewStarAward(participantStarsBefore, existingStaffStars = 0) {
  const participantStars = Number(participantStarsBefore) || 0;
  const existingStars = Number(existingStaffStars) || 0;
  const available = Math.max(0, MAX_PARTICIPANT_STARS - (participantStars - existingStars));
  return Math.min(MAX_REVIEW_STARS_PER_PROJECT, available);
}

export function normalizeProjectComment(body) {
  if (typeof body !== "string") {
    throw new Error("Comments must be between 1 and 2,000 characters.");
  }
  const text = body.trim();
  if (!text || text.length > 2000) {
    throw new Error("Comments must be between 1 and 2,000 characters.");
  }
  return text;
}
