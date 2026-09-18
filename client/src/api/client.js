let csrfToken = null;
let csrfTokenPromise = null;

export function loadCsrfToken() {
  if (csrfToken) {
    return Promise.resolve(csrfToken);
  }

  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch("/api/csrf-token", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        csrfToken = typeof data?.csrfToken === "string" ? data.csrfToken : null;
        return csrfToken;
      })
      .catch(() => null);
  }

  return csrfTokenPromise;
}

export async function apiFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers ?? {});

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = await loadCsrfToken();
    if (token) {
      headers.set("X-CSRF-Token", token);
    }
  }

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: options.credentials ?? "include",
  });
}
