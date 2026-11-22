import test from "node:test";
import assert from "node:assert/strict";
import {
  canAwardExploreStar,
  exploreStarEligibilityError,
  isPublicCommunityProject,
  maxReviewStarAward,
  normalizeProjectComment,
  PUBLIC_PROJECT_EXCLUDED_STATUSES,
} from "./communityRules.js";

test("community visibility excludes blocked, fraudulent, and terminal projects", () => {
  assert.equal(isPublicCommunityProject({ status: "draft" }), true);
  assert.equal(isPublicCommunityProject({ status: "in-review" }), true);
  assert.equal(isPublicCommunityProject({ status: "approved", shipped: false }), true);
  assert.equal(isPublicCommunityProject({ status: null }), true);
  assert.equal(isPublicCommunityProject({ status: "blocked" }), false);
  assert.equal(isPublicCommunityProject({ status: "archived" }), false);
  assert.equal(isPublicCommunityProject({ blocked: true, status: "draft" }), false);
  assert.equal(isPublicCommunityProject({ fraud_flag: true, status: "draft" }), false);
  for (const status of PUBLIC_PROJECT_EXCLUDED_STATUSES) {
    assert.equal(isPublicCommunityProject({ status: status.toUpperCase() }), false, status);
  }
});

test("Explore star eligibility respects owner, repeat-award, and participant-cap rules", () => {
  assert.equal(canAwardExploreStar({ ownerUserId: 10, staffUserId: 20, participantStars: 4 }), true);
  assert.equal(canAwardExploreStar({ ownerUserId: 20, staffUserId: 20, participantStars: 0 }), false);
  assert.equal(canAwardExploreStar({ ownerUserId: 10, staffUserId: 20, participantStars: 5 }), false);
  assert.equal(canAwardExploreStar({ ownerUserId: 10, staffUserId: null, participantStars: 0 }), false);
  assert.equal(canAwardExploreStar({ ownerUserId: 10, staffUserId: 20, participantStars: 0, alreadyAwarded: true }), false);
});

test("a reviewer who removes a prior review award still cannot award again in Explore", () => {
  const project = { id: 50, user_id: 10, status: "in-review" };
  assert.match(exploreStarEligibilityError({
    project,
    staffUserId: 20,
    participantStars: 0,
    alreadyAwarded: true,
  }), /already awarded/);
});

test("Explore star denial messages cover hidden projects, self-awards, repeats, and the cap", () => {
  assert.match(exploreStarEligibilityError({
    project: { id: 1, user_id: 10, status: "banned" },
    staffUserId: 20,
    participantStars: 0,
  }), /not available/);
  assert.match(exploreStarEligibilityError({
    project: { id: 1, user_id: 20, status: "draft" },
    staffUserId: 20,
    participantStars: 0,
  }), /shipped/);
  assert.match(exploreStarEligibilityError({
    project: { id: 1, user_id: 10, status: "draft" },
    staffUserId: 20,
    participantStars: 0,
    alreadyAwarded: true,
  }), /already awarded/);
  assert.match(exploreStarEligibilityError({
    project: { id: 1, user_id: 10, status: "draft" },
    staffUserId: 20,
    participantStars: 5,
  }), /5-star limit/);
});

test("review award limits allow at most two stars and never exceed the participant cap", () => {
  assert.equal(maxReviewStarAward(0, 0), 2);
  assert.equal(maxReviewStarAward(4, 0), 1);
  assert.equal(maxReviewStarAward(5, 0), 0);
  assert.equal(maxReviewStarAward(5, 1), 1);
  assert.equal(maxReviewStarAward(6, 2), 1);
});

test("comment validation trims text and enforces the UI length and type limits", () => {
  assert.equal(normalizeProjectComment("  Nice work!  "), "Nice work!");
  assert.equal(normalizeProjectComment("x".repeat(2000)), "x".repeat(2000));
  assert.throws(() => normalizeProjectComment(" \n\t "), /1 and 2,000/);
  assert.throws(() => normalizeProjectComment("x".repeat(2001)), /1 and 2,000/);
  assert.throws(() => normalizeProjectComment({ body: "unexpected object" }), /1 and 2,000/);
});
