import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (testDatabaseUrl) {
  const databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1));
  if (!/_test(?:$|_)/i.test(databaseName)) {
    throw new Error("TEST_DATABASE_URL must point to a database whose name contains a _test suffix.");
  }
  // The application pool reads DATABASE_URL at module load. Only honor the
  // explicit test-only variable so this suite can never target the dev DB by
  // accident.
  process.env.DATABASE_URL = testDatabaseUrl;
}

test("community SQL flows enforce visibility, social actions, stars, and public pages", {
  skip: !testDatabaseUrl,
}, async () => {
  const [{ pool }, { runDatabaseMigration }, community, projects] = await Promise.all([
    import("./db.js"),
    import("./migrate.js"),
    import("./community.js"),
    import("./projects.js"),
  ]);

  const suffix = randomUUID();
  const users = [
    { key: "owner", sub: `community-owner-${suffix}`, slug: `owner-${suffix}`, role: "member" },
    { key: "reviewer", sub: `community-reviewer-${suffix}`, slug: `reviewer-${suffix}`, role: "reviewer" },
    { key: "staff", sub: `community-staff-${suffix}`, slug: `staff-${suffix}`, role: "admin" },
    { key: "raceOwner", sub: `community-race-owner-${suffix}`, slug: `race-owner-${suffix}`, role: "member" },
  ];
  const userIds = {};
  const projectIds = {};

  try {
    await runDatabaseMigration();

    for (const user of users) {
      const result = await pool.query(
        `INSERT INTO users (hackclub_sub, name, slug, role)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [user.sub, user.slug, user.slug, user.role]
      );
      userIds[user.key] = Number(result.rows[0].id);
    }

    const ownerProject = await pool.query(
      `INSERT INTO projects (user_id, name, description, status, shipped, created_at)
       VALUES ($1, 'Public draft', 'A draft should appear in Explore', 'draft', FALSE, NOW() - INTERVAL '3 days')
       RETURNING id`,
      [userIds.owner]
    );
    projectIds.public = Number(ownerProject.rows[0].id);

    const ownReviewProject = await pool.query(
      `INSERT INTO projects (user_id, name, status, shipped, reviewed, created_at)
       VALUES ($1, 'Owner review project', 'in-review', TRUE, FALSE, NOW() - INTERVAL '2 days')
       RETURNING id`,
      [userIds.reviewer]
    );
    projectIds.ownReview = Number(ownReviewProject.rows[0].id);

    const cappedProject = await pool.query(
      `INSERT INTO projects (user_id, name, status, shipped, reviewed, stars, created_at)
       VALUES ($1, 'Participant already has four stars', 'approved', TRUE, TRUE, 4, NOW() - INTERVAL '1 day')
       RETURNING id`,
      [userIds.owner]
    );
    projectIds.capped = Number(cappedProject.rows[0].id);
    await pool.query(
      `INSERT INTO project_star_awards (project_id, staff_user_id, stars, source)
       VALUES ($1, NULL, 4, 'legacy')`,
      [projectIds.capped]
    );

    const reviewProject = await pool.query(
      `INSERT INTO projects (user_id, name, description, status, shipped, reviewed, created_at)
       VALUES ($1, 'Reviewable project', 'Ready for review', 'in-review', TRUE, FALSE, NOW())
       RETURNING id`,
      [userIds.owner]
    );
    projectIds.review = Number(reviewProject.rows[0].id);
    await pool.query(
      `INSERT INTO journal_entries (user_id, project_id, project_name, time_done, hours_worked, description)
       VALUES ($1, $2, 'Reviewable project', NOW() - INTERVAL '1 hour', 2, 'Built a useful feature')`,
      [userIds.owner, projectIds.review]
    );

    const hiddenProject = await pool.query(
      `INSERT INTO projects (user_id, name, status, shipped, fraud_flag)
       VALUES ($1, 'Hidden project', 'approved', TRUE, TRUE)
       RETURNING id`,
      [userIds.owner]
    );
    projectIds.hidden = Number(hiddenProject.rows[0].id);
    const bannedProject = await pool.query(
      `INSERT INTO projects (user_id, name, status, shipped)
       VALUES ($1, 'Banned project', 'banned', TRUE)
       RETURNING id`,
      [userIds.owner]
    );
    projectIds.banned = Number(bannedProject.rows[0].id);

    const explore = await community.listExploreProjects({
      viewerUserId: userIds.reviewer,
      staffUserId: userIds.reviewer,
    });
    assert.deepEqual(explore.map((project) => project.id), [
      projectIds.public,
      projectIds.ownReview,
      projectIds.capped,
      projectIds.review,
    ]);
    assert.equal(explore.find((project) => project.id === projectIds.public).canAwardStar, true);
    assert.equal(explore.find((project) => project.id === projectIds.ownReview).canAwardStar, false);
    assert.equal(explore.some((project) => project.id === projectIds.hidden || project.id === projectIds.banned), false);

    assert.equal((await projects.listAdminReviewProjects({ reviewerUserId: userIds.reviewer })).pendingProjects.some(
      (project) => project.id === projectIds.ownReview
    ), false);
    assert.equal(await projects.getAdminReviewProject(projectIds.ownReview, userIds.reviewer), null);
    await assert.rejects(
      projects.awardStarsToProject(userIds.reviewer, projectIds.ownReview, 1),
      /project you shipped/
    );

    assert.deepEqual(await community.markExploreProjectViewed(userIds.reviewer, projectIds.public), { viewed: true });
    assert.deepEqual(await community.markExploreProjectViewed(userIds.reviewer, projectIds.public), { viewed: false });
    const unseen = await community.listExploreProjects({ viewerUserId: userIds.reviewer });
    assert.equal(unseen.some((project) => project.id === projectIds.public), false);
    const searched = await community.listExploreProjects({ viewerUserId: userIds.reviewer, search: "Public draft" });
    assert.equal(searched.some((project) => project.id === projectIds.public), true);

    assert.deepEqual(await community.toggleProjectLike(userIds.reviewer, projectIds.public), { liked: true, likeCount: 1 });
    assert.deepEqual(await community.toggleProjectLike(userIds.reviewer, projectIds.public), { liked: false, likeCount: 0 });
    const concurrentLikes = await Promise.all([
      community.toggleProjectLike(userIds.reviewer, projectIds.public),
      community.toggleProjectLike(userIds.staff, projectIds.public),
    ]);
    assert.deepEqual(concurrentLikes.map((result) => result.likeCount).sort(), [1, 2]);
    assert.equal((await community.listExploreProjects({ search: "Public draft" }))[0].likeCount, 2);
    await community.toggleProjectLike(userIds.reviewer, projectIds.public);
    await community.toggleProjectLike(userIds.staff, projectIds.public);
    await assert.rejects(community.toggleProjectLike(userIds.reviewer, projectIds.hidden), /Project not found/);
    const comment = await community.createProjectComment(userIds.reviewer, projectIds.public, "  Nice work!  ");
    assert.equal(comment.body, "Nice work!");
    assert.equal((await community.listProjectComments(projectIds.public, userIds.reviewer))[0].isOwnComment, true);
    assert.equal(await community.deleteProjectComment(userIds.staff, comment.id), false);
    assert.equal(await community.deleteProjectComment(userIds.reviewer, comment.id), true);
    await assert.rejects(community.createProjectComment(userIds.reviewer, projectIds.public, "   "), /1 and 2,000/);
    await assert.rejects(community.createProjectComment(userIds.reviewer, projectIds.hidden, "Can't comment here"), /Project not found/);

    assert.deepEqual(await community.toggleUserFollow(userIds.reviewer, userIds.owner), { following: true, followerCount: 1 });
    assert.deepEqual(await community.toggleUserFollow(userIds.reviewer, userIds.owner), { following: false, followerCount: 0 });
    const concurrentFollows = await Promise.all([
      community.toggleUserFollow(userIds.reviewer, userIds.owner),
      community.toggleUserFollow(userIds.staff, userIds.owner),
    ]);
    assert.deepEqual(concurrentFollows.map((result) => result.followerCount).sort(), [1, 2]);
    assert.equal((await community.getPublicParticipantPage(users[0].slug)).participant.followerCount, 2);
    await community.toggleUserFollow(userIds.reviewer, userIds.owner);
    await community.toggleUserFollow(userIds.staff, userIds.owner);
    await assert.rejects(community.toggleUserFollow(userIds.owner, userIds.owner), /follow yourself/);
    await assert.rejects(community.toggleUserFollow(userIds.reviewer, -999999), /Participant not found/);

    await assert.rejects(projects.awardStarsToProject(userIds.reviewer, projectIds.review, 2), /at most 1 more star/);
    const reviewAward = await projects.awardStarsToProject(userIds.reviewer, projectIds.review, 1);
    assert.equal(reviewAward.project.stars, 1);
    assert.equal(reviewAward.participantTotalStars, 5);
    await projects.awardStarsToProject(userIds.reviewer, projectIds.review, 0);
    await assert.rejects(projects.awardExploreStar(userIds.reviewer, projectIds.review), /already awarded/);
    const exploreAward = await projects.awardExploreStar(userIds.staff, projectIds.review);
    assert.equal(exploreAward.project.stars, 1);
    assert.equal(exploreAward.participantTotalStars, 5);
    await assert.rejects(projects.awardExploreStar(userIds.staff, projectIds.public), /reached the 5-star limit/);
    await assert.rejects(projects.awardExploreStar(userIds.owner, projectIds.public), /project that you shipped/);
    await assert.rejects(projects.awardExploreStar(userIds.staff, projectIds.hidden), /not available in Explore/);

    const projectPage = await community.getPublicProjectPage(projectIds.review, userIds.reviewer);
    assert.equal(projectPage.project.id, projectIds.review);
    assert.equal(projectPage.data.journals.length, 1);
    assert.equal(projectPage.data.journals[0].hoursWorked, 2);
    assert.equal(await community.getPublicProjectPage(projectIds.hidden), null);

    const participantPage = await community.getPublicParticipantPage(users[0].slug, userIds.reviewer);
    assert.equal(participantPage.participant.projectCount, 3);
    assert.equal(participantPage.participant.shippedCount, 2);
    assert.equal(participantPage.participant.totalStars, 5);
    assert.equal(participantPage.projects.some((project) => project.id === projectIds.hidden), false);
    assert.equal(await community.getPublicParticipantPage(`missing-${suffix}`), null);

    const raceCap = await pool.query(
      `INSERT INTO projects (user_id, name, status, stars, shipped)
       VALUES ($1, 'Concurrent cap baseline', 'approved', 4, TRUE) RETURNING id`,
      [userIds.raceOwner]
    );
    await pool.query(
      `INSERT INTO project_star_awards (project_id, staff_user_id, stars, source)
       VALUES ($1, NULL, 4, 'legacy')`,
      [raceCap.rows[0].id]
    );
    const raceTargets = await pool.query(
      `INSERT INTO projects (user_id, name, status, shipped)
       VALUES ($1, 'Concurrent award A', 'draft', FALSE), ($1, 'Concurrent award B', 'draft', FALSE)
       RETURNING id`,
      [userIds.raceOwner]
    );
    const concurrentAwards = await Promise.allSettled([
      projects.awardExploreStar(userIds.reviewer, Number(raceTargets.rows[0].id)),
      projects.awardExploreStar(userIds.staff, Number(raceTargets.rows[1].id)),
    ]);
    assert.equal(concurrentAwards.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrentAwards.filter((result) => result.status === "rejected").length, 1);
    const raceTotals = await pool.query(
      `SELECT COALESCE(SUM(stars), 0)::int AS stars FROM projects WHERE user_id = $1`,
      [userIds.raceOwner]
    );
    assert.equal(Number(raceTotals.rows[0].stars), 5);
  } finally {
    await pool.query(`DELETE FROM users WHERE hackclub_sub = ANY($1::text[])`, [users.map((user) => user.sub)]);
    await pool.end();
  }
});
