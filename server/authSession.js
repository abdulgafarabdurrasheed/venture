export function hackclubSubFromProfile(profile) {
  const nestedIdentity =
    profile?.identity && typeof profile.identity === "object" ? profile.identity : null;
  const source = nestedIdentity ?? profile;

  const subCandidate =
    source?.sub ??
    source?.id ??
    source?.public_id ??
    source?.identity_id ??
    source?.user_id ??
    source?.uid ??
    source?.hc_id ??
    null;

  if (subCandidate !== undefined && subCandidate !== null && String(subCandidate).trim()) {
    return String(subCandidate).trim();
  }

  const slackId = source?.slack_id ?? source?.slackId;
  if (slackId !== undefined && slackId !== null && String(slackId).trim()) {
    return `slack:${String(slackId).trim()}`;
  }

  const emailCandidate =
    source?.email ??
    source?.primary_email ??
    source?.email_address ??
    source?.primaryEmail ??
    null;

  if (typeof emailCandidate === "string" && emailCandidate.trim()) {
    return `email:${emailCandidate.trim().toLowerCase()}`;
  }

  return null;
}
