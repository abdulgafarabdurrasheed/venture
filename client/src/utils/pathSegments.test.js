import test from "node:test";
import assert from "node:assert/strict";
import { decodePathSegment } from "./pathSegments.js";

test("path segments decode encoded spaces and unicode exactly once", () => {
  assert.equal(decodePathSegment("maker%20name"), "maker name");
  assert.equal(decodePathSegment("caf%C3%A9"), "café");
  assert.equal(decodePathSegment("literal%252Fvalue"), "literal%2Fvalue");
});

test("malformed percent escapes do not crash route rendering", () => {
  assert.equal(decodePathSegment("maker%2"), "maker%2");
});
