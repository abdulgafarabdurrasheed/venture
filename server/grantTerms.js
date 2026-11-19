export const GRANT_TERMS_VERSION = "venture-travel-grant-2026-11-v1";

export const GRANT_ACKNOWLEDGMENTS = Object.freeze([
  Object.freeze({
    id: "hcb-card-purpose",
    text: "I acknowledge that by receiving this grant I will be issued an HCB prepaid card, which may only be used for the purchase of the specified item(s) for the purpose of my own travel.",
  }),
  Object.freeze({
    id: "personal-expenses-only",
    text: "I confirm that all expenses made with this grant are strictly for personal use and may not be used to cover costs for other individuals, including friends, family members, or any third parties.",
  }),
  Object.freeze({
    id: "program-rules",
    text: "I understand that any violation of these rules may result in permanent removal from the Hack Club ecosystem and may be treated as fraudulent activity.",
  }),
  Object.freeze({
    id: "travel-responsibility",
    text: "I understand that Hack Club is not responsible for any aspect of my travel, safety, or experiences, and that this grant solely provides financial support for my adventure.",
  }),
]);

export function getGrantTermsForDisplay() {
  return {
    version: GRANT_TERMS_VERSION,
    acknowledgments: GRANT_ACKNOWLEDGMENTS,
  };
}

export function snapshotAcknowledgedGrantTerms(input = {}) {
  const version = String(input.grantTermsVersion ?? input.grant_terms_version ?? "").trim();
  if (version !== GRANT_TERMS_VERSION) {
    throw new Error("Grant terms changed. Review the current statements and acknowledge them again.");
  }

  const submittedIds = Array.isArray(input.acknowledgedIds ?? input.acknowledged_ids)
    ? [...new Set((input.acknowledgedIds ?? input.acknowledged_ids).map((id) => String(id).trim()))].sort()
    : [];
  const expectedIds = GRANT_ACKNOWLEDGMENTS.map((entry) => entry.id).sort();
  if (submittedIds.length !== expectedIds.length || submittedIds.some((id, index) => id !== expectedIds[index])) {
    throw new Error("Acknowledge every grant statement before submitting your order.");
  }

  return JSON.stringify(GRANT_ACKNOWLEDGMENTS);
}
