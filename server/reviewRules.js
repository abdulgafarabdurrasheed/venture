export function assertReviewerIsNotProjectOwner(reviewerUserId, projectUserId) {
  if (
    reviewerUserId != null &&
    projectUserId != null &&
    Number(reviewerUserId) === Number(projectUserId)
  ) {
    throw new Error("You can't review a project you own.");
  }
}
