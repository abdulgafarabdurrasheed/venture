export async function readJsonResponse(response) {
  const body = await response.text();
  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    const gotHtml = body.trimStart().startsWith("<!");
    const hint = gotHtml
      ? " The API returned HTML instead of JSON. Run `npm run dev:full` and make sure the Node server started (look for `Server http://...:3000` in the terminal). If you run a second copy of this repo, give it different PORT and VITE_DEV_PORT values so they do not fight over :3000 / :5173."
      : "";
    throw new Error(`Invalid server response (${response.status}).${hint}`);
  }
}
