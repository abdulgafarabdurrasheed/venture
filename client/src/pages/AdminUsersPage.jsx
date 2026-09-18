import { apiFetch } from "../api/client.js";
import { useEffect, useMemo, useState } from "react";
import "./AdminUsersPage.css";

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function fmt(n, decimals = 1) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toFixed(decimals).replace(/\.0+$/, "") : "—";
}

function displayName(user) {
  return user.slug ? `@${user.slug}` : user.email?.split("@")[0] || `User #${user.id}`;
}

const STATUS_META = {
  draft:      { color: "#c9a87c", bg: "rgb(196 165 116 / 12%)", border: "rgb(196 165 116 / 40%)" },
  "in-review":{ color: "#ffd740", bg: "rgb(255 215 64 / 12%)",  border: "rgb(255 215 64 / 40%)"  },
  approved:   { color: "#9cffcf", bg: "rgb(156 255 207 / 12%)", border: "rgb(156 255 207 / 40%)" },
  rejected:   { color: "#ff8fab", bg: "rgb(255 143 171 / 12%)", border: "rgb(255 143 171 / 40%)" },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.draft;
  return (
    <span className="auser-badge" style={{ color: m.color, background: m.bg, borderColor: m.border }}>
      {status}
    </span>
  );
}

function UserDetailView({ userId }) {
  const [user, setUser] = useState(null);
  const [audit, setAudit] = useState([]);
  const [status, setStatus] = useState("Loading…");
  const [error, setError] = useState("");
  const [balanceDelta, setBalanceDelta] = useState("");
  const [balanceReason, setBalanceReason] = useState("");
  const [balanceStatus, setBalanceStatus] = useState("");
  const [balanceError, setBalanceError] = useState("");

  function loadUser() {
    setStatus("Loading…");
    setError("");
    Promise.all([
      apiFetch(`/api/admin/users/${userId}`, { credentials: "include" }).then((r) => r.json()),
      apiFetch(`/api/admin/users/${userId}/audit`, { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([userData, auditData]) => {
        if (userData.error) throw new Error(userData.error);
        setUser(userData.user);
        setAudit(auditData.entries || []);
        setStatus("");
      })
      .catch((err) => {
        setError(err.message);
        setStatus("");
      });
  }

  useEffect(() => {
    loadUser();
  }, [userId]);

  async function handleBalanceSubmit(e) {
    e.preventDefault();
    const delta = Number(balanceDelta);
    if (!Number.isFinite(delta) || delta === 0) {
      setBalanceError("Enter a non-zero number.");
      return;
    }
    setBalanceError("");
    setBalanceStatus("Saving…");
    try {
      const r = await apiFetch(`/api/admin/users/${userId}/balance`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta, reason: balanceReason }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed.");
      setBalanceStatus(`Done — new balance: ${fmt(data.user.coins, 0)} Coins`);
      setBalanceDelta("");
      setBalanceReason("");
      loadUser();
    } catch (err) {
      setBalanceError(err.message);
      setBalanceStatus("");
    }
  }

  if (status) {
    return (
      <main className="admin-users-page">
        <section className="admin-users-content">
          <a href="/admin/users" className="admin-users-back">
            ← All users
          </a>
          <p className="auser-muted">{status}</p>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="admin-users-page">
        <section className="admin-users-content">
          <a href="/admin/users" className="admin-users-back">
            ← All users
          </a>
          <p className="admin-users-error">{error}</p>
        </section>
      </main>
    );
  }

  if (!user) return null;

  const projectTotalHours = (user.projects || []).reduce((s, p) => s + p.totalHours, 0);
  const projectApprovedHours = (user.projects || []).reduce((s, p) => s + p.approvedHours, 0);
  const projectcoinsEarned = (user.projects || []).reduce((s, p) => s + p.coinsEarned, 0);

  return (
    <main className="admin-users-page">
      <section className="admin-users-content">
        <a href="/admin/users" className="admin-users-back">
          ← All users
        </a>

        {/* Header */}
        <div className="auser-header">
          {user.profileImageUrl ? (
            <img className="auser-avatar" src={user.profileImageUrl} alt="" aria-hidden="true" />
          ) : (
            <div className="auser-avatar-placeholder" aria-hidden="true">
              {displayName(user).charAt(0).toUpperCase()}
            </div>
          )}
          <div className="auser-header-info">
            <h1>{displayName(user)}</h1>
            <span className="auser-role-badge" data-role={user.role}>
              {user.role || "member"}
            </span>
          </div>
        </div>

        {/* Info grid */}
        <dl className="admin-user-details">
          <div>
            <dt>Email</dt>
            <dd>{user.email || "—"}</dd>
          </div>
          <div>
            <dt>Slug</dt>
            <dd>{user.slug || "—"}</dd>
          </div>
          <div>
            <dt>Joined</dt>
            <dd>{formatDate(user.createdAt)}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatDate(user.updatedAt)}</dd>
          </div>
          <div>
            <dt>Hackatime</dt>
            <dd>
              {user.hackatimeConnectedAt
                ? `Connected ${formatDate(user.hackatimeConnectedAt)}`
                : "Not connected"}
              {user.hackatimeTotalHours > 0 && (
                <span className="auser-muted"> — {fmt(user.hackatimeTotalHours)} hrs tracked</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Coins balance</dt>
            <dd className="auser-bricks">{fmt(user.coins, 0)} Coins</dd>
          </div>
        </dl>

        {/* Project summary */}
        <div className="auser-summary-row">
          <div className="auser-summary-card">
            <span>{(user.projects || []).length}</span>
            <span>Projects</span>
          </div>
          <div className="auser-summary-card">
            <span>{fmt(projectTotalHours)}</span>
            <span>Total hrs</span>
          </div>
          <div className="auser-summary-card">
            <span>{fmt(projectApprovedHours)}</span>
            <span>Approved hrs</span>
          </div>
          <div className="auser-summary-card">
            <span>{fmt(projectcoinsEarned, 0)}</span>
            <span>Coins earned</span>
          </div>
        </div>

        {/* Projects table */}
        {user.projects && user.projects.length > 0 ? (
          <section className="auser-projects">
            <h2 className="auser-section-title">Projects</h2>
            <div className="admin-users-table-wrap">
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Journal hrs</th>
                    <th>Total hrs</th>
                    <th>Approved hrs</th>
                    <th>Coins earned</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {user.projects.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <a
                          className="admin-users-inline-link"
                          href={`/admin/review/project/${p.id}`}
                        >
                          {p.name}
                        </a>
                        {p.fraudFlag ? <span className="auser-fraud-flag"> ⚑ fraud</span> : null}
                      </td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                      <td>{fmt(p.journalHours)}</td>
                      <td>{fmt(p.totalHours)}</td>
                      <td>{fmt(p.approvedHours)}</td>
                      <td>{fmt(p.coinsEarned, 0)}</td>
                      <td>{formatDate(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <p className="auser-muted" style={{ marginTop: "1.5rem" }}>
            No projects yet.
          </p>
        )}

        {/* Balance adjustment */}
        <section className="auser-balance-section">
          <h2 className="auser-section-title">Adjust Balance</h2>
          <p className="auser-muted">
            Current balance: <strong className="auser-bricks">{fmt(user.coins, 0)} Coins</strong>.
            Enter a positive number to add, negative to deduct.
          </p>
          <form className="auser-balance-form" onSubmit={handleBalanceSubmit}>
            <label>
              <span>Delta (Coins)</span>
              <input
                type="number"
                step="0.01"
                placeholder="e.g. 50 or -20"
                value={balanceDelta}
                onChange={(e) => setBalanceDelta(e.target.value)}
                required
              />
            </label>
            <label>
              <span>Reason (for audit log)</span>
              <input
                type="text"
                placeholder="Correction, bonus, etc."
                value={balanceReason}
                onChange={(e) => setBalanceReason(e.target.value)}
                maxLength={300}
              />
            </label>
            <button type="submit">Apply adjustment</button>
          </form>
          {balanceStatus ? <p className="auser-balance-ok">{balanceStatus}</p> : null}
          {balanceError ? <p className="admin-users-error">{balanceError}</p> : null}
        </section>

        {/* Audit log */}
        {audit.length > 0 ? (
          <section className="auser-audit">
            <h2 className="auser-section-title">Audit Log</h2>
            <div className="admin-users-table-wrap">
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>By</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDate(entry.createdAt)}</td>
                      <td>{entry.action}</td>
                      <td>{entry.adminEmail || "—"}</td>
                      <td>
                        {entry.details ? (
                          <code className="auser-audit-detail">
                            {JSON.stringify(entry.details)}
                          </code>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

export function AdminUsersPage({ userId = null }) {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("any");
  const [sort, setSort] = useState("created_desc");
  const [status, setStatus] = useState("Loading users…");
  const [error, setError] = useState("");

  useEffect(() => {
    if (userId) return;
    let active = true;
    setStatus("Loading users…");
    setError("");
    apiFetch("/api/admin/users", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data.error) throw new Error(data.error);
        setUsers(data.users || []);
        setStatus("");
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setStatus("");
        }
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const visibleUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = users.filter((u) => {
      const blob = [u.email, u.slug, u.role]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (!q || blob.includes(q)) && (roleFilter === "any" || u.role === roleFilter);
    });

    const [key, dir] = sort.split("_");
    const mul = dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      if (key === "name") return mul * displayName(a).localeCompare(displayName(b));
      if (key === "role") return mul * String(a.role || "").localeCompare(String(b.role || ""));
      return mul * (new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    });
  }, [query, roleFilter, sort, users]);

  if (userId) {
    return <UserDetailView userId={userId} />;
  }

  return (
    <main className="admin-users-page">
      <section className="admin-users-content">
        <a href="/admin" className="admin-users-back">
          ← Admin home
        </a>
        <h1>Users</h1>
        <p className="admin-users-intro">
          Participant details, roles, balances, and project activity.
        </p>

        <div className="admin-users-filters">
          <label>
            Search
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Email, Slack handle, role…"
            />
          </label>
          <label>
            Role
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="any">Any role</option>
              <option value="member">Members</option>
              <option value="reviewer">Reviewers</option>
              <option value="admin">Admins</option>
              <option value="superadmin">Superadmins</option>
            </select>
          </label>
          <label>
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="created_desc">Newest first</option>
              <option value="created_asc">Oldest first</option>
              <option value="name_asc">Slack A–Z</option>
              <option value="name_desc">Slack Z–A</option>
              <option value="role_asc">Role A–Z</option>
              <option value="role_desc">Role Z–A</option>
            </select>
          </label>
        </div>

        {status ? <p className="auser-muted">{status}</p> : null}
        {error ? <p className="admin-users-error">{error}</p> : null}

        <div className="admin-users-table-wrap">
          <table className="admin-users-table">
            <thead>
              <tr>
                <th>Participant</th>
                <th>Role</th>
                <th>Coins</th>
                <th>Joined</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.length === 0 && !status ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: "center", color: "#c9a87c" }}>
                    No users found.
                  </td>
                </tr>
              ) : (
                visibleUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <a className="admin-users-profile-link" href={`/admin/users/${u.id}`}>
                        {displayName(u)}
                      </a>
                      <span>{u.email || "—"}</span>
                    </td>
                    <td>
                      <span className="auser-role-badge" data-role={u.role}>
                        {u.role || "member"}
                      </span>
                    </td>
                    <td className="auser-bricks-cell">{fmt(u.coins, 0)}</td>
                    <td>{formatDate(u.createdAt)}</td>
                    <td>{formatDate(u.updatedAt)}</td>
                    <td>
                      <a className="admin-users-inline-link" href={`/admin/users/${u.id}`}>
                        View
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
