const airtableToken =
  process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
const airtableBaseId =
  process.env.AIRTABLE_PROJECTS_BASE_ID || process.env.AIRTABLE_APP || process.env.AIRTABLE_BASE_ID;
const journalsTableId = process.env.AIRTABLE_JOURNALS_TABLE_ID;

export const hasAirtableJournalsConfig = Boolean(airtableToken && airtableBaseId && journalsTableId);

function getJournalsTableUrl() {
  return `https://api.airtable.com/v0/${airtableBaseId}/${journalsTableId}`;
}

function getAirtableHeaders() {
  return {
    Authorization: `Bearer ${airtableToken}`,
    "Content-Type": "application/json",
  };
}

function airtableDate(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function buildJournalFields(row) {
  const toolsUsed = row.tools_used
    ? typeof row.tools_used === "string"
      ? row.tools_used
      : JSON.stringify(row.tools_used)
    : "";

  const fields = {
    id: String(row.id),
    "Project Name": row.project_name || "",
    Description: row.description || "",
    "Hours Worked": Number(row.hours_worked) || 0,
    "Tools Used": toolsUsed,
    "Time Done": airtableDate(row.time_done),
    "Created At": airtableDate(row.created_at),
  };

  for (const key of Object.keys(fields)) {
    if (fields[key] === undefined) delete fields[key];
  }

  return fields;
}

export async function syncJournalEntryToAirtable(row) {
  if (!hasAirtableJournalsConfig) {
    return { ok: false, skipped: true, reason: "Airtable journals not configured." };
  }

  const fields = buildJournalFields(row);

  const response = await fetch(getJournalsTableUrl(), {
    method: "PATCH",
    headers: getAirtableHeaders(),
    body: JSON.stringify({
      performUpsert: { fieldsToMergeOn: ["id"] },
      records: [{ fields }],
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Airtable journals sync failed (${response.status}): ${details}`);
  }

  const data = await response.json();
  return { ok: true, recordId: data.records?.[0]?.id };
}
