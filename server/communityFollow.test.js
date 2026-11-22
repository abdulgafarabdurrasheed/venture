import test from "node:test";
import assert from "node:assert/strict";
import { toggleUserFollowWithPool } from "./community.js";

function makeFollowPool({ userIds = [1, 2], follows = [] } = {}) {
  const state = new Set(follows.map(([follower, followed]) => `${follower}:${followed}`));
  const calls = [];
  let releases = 0;
  const pool = {
    calls,
    state,
    get releases() { return releases; },
    async connect() {
      return {
        async query(sql, params = []) {
          const normalized = sql.trim().replace(/\s+/g, " ");
          calls.push(normalized);
          if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
            return { rows: [], rowCount: 0 };
          }
          if (normalized.startsWith("SELECT id FROM users WHERE id = $1 FOR UPDATE")) {
            return { rows: userIds.includes(Number(params[0])) ? [{ id: Number(params[0]) }] : [], rowCount: 1 };
          }
          if (normalized.startsWith("DELETE FROM user_follows")) {
            const key = `${params[0]}:${params[1]}`;
            const existed = state.delete(key);
            return { rows: existed ? [{ followed_user_id: params[1] }] : [], rowCount: existed ? 1 : 0 };
          }
          if (normalized.startsWith("INSERT INTO user_follows")) {
            state.add(`${params[0]}:${params[1]}`);
            return { rows: [], rowCount: 1 };
          }
          if (normalized.startsWith("SELECT COUNT(*)::int AS count FROM user_follows")) {
            const count = [...state].filter((key) => key.endsWith(`:${params[0]}`)).length;
            return { rows: [{ count }], rowCount: 1 };
          }
          throw new Error(`Unexpected query: ${normalized}`);
        },
        release() { releases += 1; },
      };
    },
  };
  return pool;
}

test("follow toggles run under a transaction and serialize on the followed user row", async () => {
  const pool = makeFollowPool();
  assert.deepEqual(await toggleUserFollowWithPool(pool, 1, 2), { following: true, followerCount: 1 });
  assert.deepEqual(await toggleUserFollowWithPool(pool, 1, 2), { following: false, followerCount: 0 });
  assert.equal(pool.state.size, 0);
  assert.equal(pool.calls.filter((sql) => sql.includes("FOR UPDATE")).length, 2);
  assert.equal(pool.calls.filter((sql) => sql === "COMMIT").length, 2);
  assert.equal(pool.releases, 2);
});

test("follow rejects self-targets and rolls back when the participant does not exist", async () => {
  const pool = makeFollowPool({ userIds: [1] });
  await assert.rejects(toggleUserFollowWithPool(pool, 1, 1), /can't follow yourself/);
  assert.equal(pool.calls.length, 0);
  await assert.rejects(toggleUserFollowWithPool(pool, 1, 2), /Participant not found/);
  assert.equal(pool.calls.at(-1), "ROLLBACK");
  assert.equal(pool.releases, 1);
});
