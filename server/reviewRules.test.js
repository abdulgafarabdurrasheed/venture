import test from "node:test";
import assert from "node:assert/strict";
import { assertReviewerIsNotProjectOwner } from "./reviewRules.js";

test("review guard rejects the owner even when database and session IDs use different types", () => {
  assert.throws(() => assertReviewerIsNotProjectOwner("42", 42), /can't review a project you own/);
});

test("review guard allows a different reviewer and tolerates absent optional IDs", () => {
  assert.doesNotThrow(() => assertReviewerIsNotProjectOwner(41, 42));
  assert.doesNotThrow(() => assertReviewerIsNotProjectOwner(null, 42));
  assert.doesNotThrow(() => assertReviewerIsNotProjectOwner(42, undefined));
});
