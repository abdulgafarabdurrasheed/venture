import { useEffect, useState } from "react";
import { PlatformShell } from "../platform/PlatformShell.jsx";

export function TestPage() {
  const [health, setHealth] = useState(null);
  const [dbHealth, setDbHealth] = useState(null);

  useEffect(() => {
    async function load() {
      const [healthRes, dbRes] = await Promise.all([
        fetch("/api/health", { credentials: "include" }),
        fetch("/api/db/health", { credentials: "include" }),
      ]);
      setHealth(await healthRes.json());
      setDbHealth(await dbRes.json());
    }

    load();
  }, []);

  return (
    <PlatformShell title="Dev Test Page">
      <p className="platform-muted">Localhost-only diagnostics placeholder.</p>
      <h2>API health</h2>
      <pre className="platform-pre">{JSON.stringify(health, null, 2)}</pre>
      <h2>Database health</h2>
      <pre className="platform-pre">{JSON.stringify(dbHealth, null, 2)}</pre>
    </PlatformShell>
  );
}
