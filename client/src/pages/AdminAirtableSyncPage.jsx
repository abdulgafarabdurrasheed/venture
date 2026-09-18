import { apiFetch } from "../api/client.js";
import { useEffect, useState } from "react";
import "./AdminPage.css";

export function AdminAirtableSyncPage() {
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncError, setSyncError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [lastSyncResult, setLastSyncResult] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [status, setStatus] = useState("Loading sync status...");

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      try {
        await loadSyncStatus();
        if (isMounted) setStatus("");
      } catch (err) {
        if (isMounted) {
          setSyncError(err.message);
          setStatus("");
        }
      }
    }

    bootstrap();
    return () => {
      isMounted = false;
    };
  }, []);

  async function loadSyncStatus() {
    const response = await apiFetch("/api/airtable/status");
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const data = isJson ? await response.json() : {};
    if (!response.ok) {
      throw new Error(data.error || "Failed to load sync status.");
    }
    setSyncStatus(data);
    return data;
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    setSyncError("");
    setSyncMessage("");
    setLastSyncResult(null);
    try {
      const response = await apiFetch("/api/airtable/sync", { method: "POST" });
      const isJson = response.headers.get("content-type")?.includes("application/json");
      const data = isJson ? await response.json() : {};
      if (!response.ok) {
        throw new Error(data.error || data.message || data.reason || "Failed to sync Airtable.");
      }
      setLastSyncResult(data);
      setSyncMessage("Sync finished.");
      await loadSyncStatus();
    } catch (err) {
      setSyncError(err.message);
    } finally {
      setIsSyncing(false);
    }
  }

  const periodic = syncStatus?.periodic;
  const yswsConfig = syncStatus?.ysws;
  const ordersConfig = syncStatus?.orders;
  const lastPeriodic = periodic?.lastSync;
  const lastSyncTime = lastPeriodic?.finishedAt
    ? new Date(lastPeriodic.finishedAt).toLocaleString()
    : "Never synced";

  return (
    <main className="admin-page" aria-label="Airtable sync admin page">
      <section className="admin-content">
        <a className="admin-back-link" href="/admin">
          ← Admin home
        </a>
        <h1>Airtable Sync</h1>

        <section className="admin-airtable">
          <h2>Airtable Sync</h2>
          <p className="admin-airtable-subtitle">
            Re-sync users, projects, YSWS submissions, and shop orders from the latest database state.
          </p>

          <div className="admin-airtable-sync-row">
            <div>
              <strong>Airtable sync</strong>
              <span>Last update: {lastSyncTime}</span>
            </div>
            <button type="button" onClick={handleSyncNow} disabled={isSyncing}>
              {isSyncing ? "Syncing..." : "Sync now"}
            </button>
          </div>

          {yswsConfig ? (
            <div className="admin-airtable-details">
              <strong>YSWS target</strong>
              <p>
                {yswsConfig.configured ? (
                  <>
                    <code>{yswsConfig.table}</code> in base <code>{yswsConfig.baseId}</code> (fields:{" "}
                    {yswsConfig.fieldMode}
                    {yswsConfig.fieldResolution?.tableName
                      ? `, table name "${yswsConfig.fieldResolution.tableName}", ${yswsConfig.fieldResolution.resolved} columns matched`
                      : ""}
                    )
                  </>
                ) : (
                  "YSWS not configured — set AIRTABLE_TOKEN and AIRTABLE_BASE_ID."
                )}
              </p>
              {yswsConfig.fieldMapError ? (
                <p className="admin-airtable-error">Field map error: {yswsConfig.fieldMapError}</p>
              ) : null}
              {yswsConfig.fieldResolution?.missing?.length > 0 ? (
                <p className="admin-airtable-error">
                  Missing optional columns: {yswsConfig.fieldResolution.missing.join(", ")}
                </p>
              ) : null}
              {yswsConfig.fieldResolution?.availableFieldNames?.length > 0 &&
              yswsConfig.fieldResolution?.missing?.length > 0 ? (
                <p className="admin-airtable-subtitle">
                  Table columns: {yswsConfig.fieldResolution.availableFieldNames.join(", ")}
                </p>
              ) : null}
              {yswsConfig.warnings?.length > 0
                ? yswsConfig.warnings.map((warning) => (
                    <p key={warning} className="admin-airtable-error">
                      {warning}
                    </p>
                  ))
                : null}
            </div>
          ) : null}

          {ordersConfig ? (
            <div className="admin-airtable-details">
              <strong>Shop orders target</strong>
              <p>
                {ordersConfig.configured ? (
                  <>
                    <code>{ordersConfig.table}</code> in base <code>{ordersConfig.baseId}</code>
                    {ordersConfig.fieldResolution?.tableName
                      ? ` (table name "${ordersConfig.fieldResolution.tableName}", ${ordersConfig.fieldResolution.resolved} columns matched)`
                      : ordersConfig.fieldMode
                        ? ` (fields: ${ordersConfig.fieldMode})`
                        : ""}
                  </>
                ) : (
                  "Shop orders not configured — set AIRTABLE_TOKEN and AIRTABLE_BASE_ID (optional AIRTABLE_ORDERS_TABLE_ID)."
                )}
              </p>
              {ordersConfig.fieldMapError ? (
                <p className="admin-airtable-error">Field map error: {ordersConfig.fieldMapError}</p>
              ) : null}
              {ordersConfig.fieldResolution?.missing?.length > 0 ? (
                <p className="admin-airtable-error">
                  Missing optional columns: {ordersConfig.fieldResolution.missing.join(", ")}
                </p>
              ) : null}
              {ordersConfig.fieldResolution?.availableFieldNames?.length > 0 &&
              ordersConfig.fieldResolution?.missing?.length > 0 ? (
                <p className="admin-airtable-subtitle">
                  Table columns: {ordersConfig.fieldResolution.availableFieldNames.join(", ")}
                </p>
              ) : null}
              {ordersConfig.lastError ? (
                <p className="admin-airtable-error">Last orders sync error: {ordersConfig.lastError}</p>
              ) : null}
              {ordersConfig.warnings?.length > 0
                ? ordersConfig.warnings.map((warning) => (
                    <p key={warning} className="admin-airtable-error">
                      {warning}
                    </p>
                  ))
                : null}
            </div>
          ) : null}

          {syncMessage ? <p className="admin-airtable-success">{syncMessage}</p> : null}
          {syncError ? <p className="admin-airtable-error">{syncError}</p> : null}
          {status ? <p>{status}</p> : null}

          {lastSyncResult ? (
            <div className="admin-airtable-details">
              <strong>Last sync result</strong>
              <p>
                Users: {lastSyncResult.users?.synced ?? 0} synced, {lastSyncResult.users?.failed ?? 0} failed
              </p>
              <p>
                Projects: {lastSyncResult.projects?.synced ?? 0} synced, {lastSyncResult.projects?.failed ?? 0} failed
              </p>
              <p>
                YSWS: {lastSyncResult.ysws?.synced ?? 0} synced, {lastSyncResult.ysws?.failed ?? 0} failed,{" "}
                {lastSyncResult.ysws?.skippedProjects ?? 0} skipped
                {lastSyncResult.ysws?.lastError ? ` — ${lastSyncResult.ysws.lastError}` : ""}
              </p>
              <p>
                Shop orders: {lastSyncResult.orders?.synced ?? 0} synced, {lastSyncResult.orders?.failed ?? 0} failed
                {lastSyncResult.orders?.lastError ? ` — ${lastSyncResult.orders.lastError}` : ""}
              </p>
            </div>
          ) : null}

          {lastPeriodic ? (
            <div className="admin-airtable-details">
              <strong>Previous periodic sync</strong>
              <p>
                Users: {lastPeriodic.users?.synced ?? 0} synced · Projects: {lastPeriodic.projects?.synced ?? 0} synced
                · YSWS: {lastPeriodic.ysws?.synced ?? 0} synced
                {lastPeriodic.ysws?.failed ? ` (${lastPeriodic.ysws.failed} failed)` : ""}
                · Orders: {lastPeriodic.orders?.synced ?? 0} synced
                {lastPeriodic.orders?.failed ? ` (${lastPeriodic.orders.failed} failed)` : ""}
              </p>
              {lastPeriodic.ysws?.lastError ? (
                <p className="admin-airtable-error">YSWS error: {lastPeriodic.ysws.lastError}</p>
              ) : null}
              {lastPeriodic.orders?.lastError ? (
                <p className="admin-airtable-error">Orders error: {lastPeriodic.orders.lastError}</p>
              ) : null}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
