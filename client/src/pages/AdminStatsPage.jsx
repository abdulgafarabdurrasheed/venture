import { apiFetch } from "../api/client.js";
import { useEffect, useState } from "react";
import "./AdminStatsPage.css";

function fmt(n, decimals = 1) {
  if (n === undefined || n === null) return "—";
  const num = Number(n);
  return Number.isFinite(num) ? num.toFixed(decimals).replace(/\.0+$/, "") : "—";
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="astat-card" style={accent ? { "--astat-accent": accent } : undefined}>
      <span className="astat-card-value">{value}</span>
      <span className="astat-card-label">{label}</span>
      {sub ? <span className="astat-card-sub">{sub}</span> : null}
    </div>
  );
}

function SankeyDiagram({ projects }) {
  const { total, draft, inReview, approved, rejected } = projects;

  const W = 660;
  const H = 300;
  const MARGIN = 24;
  const NODE_W = 108;
  const GAP = 10;

  const categories = [
    { label: "Draft", count: draft, color: "#c9a87c" },
    { label: "In Review", count: inReview, color: "#ffd740" },
    { label: "Approved", count: approved, color: "#9cffcf" },
    { label: "Rejected", count: rejected, color: "#ff8fab" },
  ];

  const usableH = H - MARGIN * 2;
  const totalGap = GAP * (categories.length - 1);
  const destUsableH = usableH - totalGap;

  const safeTotal = total || 1;

  let cumDestY = MARGIN;
  const nodes = categories.map(({ label, count, color }) => {
    const h = Math.max((count / safeTotal) * destUsableH, count > 0 ? 14 : 0);
    const y = cumDestY;
    cumDestY += h + GAP;
    return { label, count, color, y, h };
  });

  let cumSrcY = MARGIN;
  const paths = nodes.map((node) => {
    const srcH = (node.count / safeTotal) * usableH;
    const srcFlowY = cumSrcY;
    cumSrcY += srcH + (node.h > 0 ? 0 : 0);

    const x1 = MARGIN + NODE_W;
    const y1t = srcFlowY;
    const y1b = srcFlowY + Math.max(srcH, node.h > 0 ? 2 : 0);
    const x2 = W - NODE_W - MARGIN;
    const y2t = node.y;
    const y2b = node.y + Math.max(node.h, 2);
    const mx = (x1 + x2) / 2;

    const d = [
      `M ${x1} ${y1t}`,
      `C ${mx} ${y1t}, ${mx} ${y2t}, ${x2} ${y2t}`,
      `L ${x2} ${y2b}`,
      `C ${mx} ${y2b}, ${mx} ${y1b}, ${x1} ${y1b}`,
      "Z",
    ].join(" ");

    return { ...node, d };
  });

  return (
    <svg
      className="astat-sankey"
      viewBox={`0 0 ${W} ${H}`}
      aria-label="Project status flow diagram"
      role="img"
    >
      {/* Source node */}
      <rect
        x={MARGIN}
        y={MARGIN}
        width={NODE_W}
        height={usableH}
        rx={8}
        fill="rgb(160 120 72 / 22%)"
        stroke="#8b6239"
        strokeWidth={2}
      />
      <text
        x={MARGIN + NODE_W / 2}
        y={MARGIN + usableH / 2 - 12}
        textAnchor="middle"
        fill="#d6a47a"
        fontSize={12}
        fontFamily="Georgia, serif"
        fontWeight="bold"
      >
        All Projects
      </text>
      <text
        x={MARGIN + NODE_W / 2}
        y={MARGIN + usableH / 2 + 10}
        textAnchor="middle"
        fill="#f5e6c8"
        fontSize={22}
        fontWeight="bold"
      >
        {total}
      </text>

      {/* Flow paths */}
      {paths.map((p) =>
        p.count > 0 ? (
          <path key={p.label} d={p.d} fill={p.color} opacity={0.22} />
        ) : null
      )}

      {/* Destination nodes */}
      {nodes.map((node) => {
        const destX = W - NODE_W - MARGIN;
        if (node.h === 0) return null;
        return (
          <g key={node.label}>
            <rect
              x={destX}
              y={node.y}
              width={NODE_W}
              height={Math.max(node.h, 2)}
              rx={6}
              fill={node.color}
              opacity={0.18}
              stroke={node.color}
              strokeWidth={1.5}
            />
            {node.h >= 22 ? (
              <>
                <text
                  x={destX + NODE_W / 2}
                  y={node.y + node.h / 2 - (node.h >= 38 ? 8 : 0)}
                  textAnchor="middle"
                  fill={node.color}
                  fontSize={Math.min(12, node.h * 0.38)}
                  fontFamily="Georgia, serif"
                >
                  {node.label}
                </text>
                {node.h >= 38 && (
                  <text
                    x={destX + NODE_W / 2}
                    y={node.y + node.h / 2 + 12}
                    textAnchor="middle"
                    fill="#f5e6c8"
                    fontSize={15}
                    fontWeight="bold"
                  >
                    {node.count}
                  </text>
                )}
              </>
            ) : (
              <text
                x={destX + NODE_W + 6}
                y={node.y + node.h / 2 + 4}
                fill={node.color}
                fontSize={11}
                fontFamily="Georgia, serif"
              >
                {node.label}: {node.count}
              </text>
            )}
          </g>
        );
      })}

      {/* Legend for zero-count items */}
      {nodes
        .filter((n) => n.h === 0 && n.count === 0)
        .map((node, i) => (
          <text
            key={node.label}
            x={W - NODE_W - MARGIN + NODE_W / 2}
            y={MARGIN + usableH + 16 + i * 14}
            textAnchor="middle"
            fill={node.color}
            fontSize={10}
            opacity={0.6}
          >
            {node.label}: 0
          </text>
        ))}
    </svg>
  );
}

export function AdminStatsPage() {
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState("Loading…");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch("/api/admin/stats", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data.error) {
          setError(data.error);
        } else {
          setStats(data.stats);
        }
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
  }, []);

  return (
    <main className="admin-page" aria-label="Platform statistics">
      <section className="admin-content astat-content">
        <a className="admin-back-link" href="/admin">
          ← Admin home
        </a>
        <h1>Platform Statistics</h1>

        {status ? <p className="astat-loading">{status}</p> : null}
        {error ? <p className="astat-error">{error}</p> : null}

        {stats ? (
          <>
            {/* Projects */}
            <section className="astat-section">
              <h2 className="astat-section-title">Projects</h2>
              <div className="astat-grid">
                <StatCard label="Total Projects" value={stats.projects.total} accent="#d6a47a" />
                <StatCard label="Draft" value={stats.projects.draft} accent="#c9a87c" />
                <StatCard label="In Review" value={stats.projects.inReview} accent="#ffd740" />
                <StatCard label="Approved" value={stats.projects.approved} accent="#9cffcf" />
                <StatCard label="Rejected" value={stats.projects.rejected} accent="#ff8fab" />
              </div>

              <div className="astat-sankey-wrap">
                <h3 className="astat-sankey-title">Project Status Flow</h3>
                <SankeyDiagram projects={stats.projects} />
              </div>
            </section>

            {/* Hours */}
            <section className="astat-section">
              <h2 className="astat-section-title">Hours</h2>
              <div className="astat-grid">
                <StatCard
                  label="Total Project Hours"
                  value={fmt(stats.hours.totalProjectHours)}
                  sub="sum of all projects"
                  accent="#d6a47a"
                />
                <StatCard
                  label="Approved Hours"
                  value={fmt(stats.hours.approvedHours)}
                  sub="admin-approved"
                  accent="#9cffcf"
                />
                <StatCard
                  label="Pending Review Hours"
                  value={fmt(stats.hours.pendingReviewHours)}
                  sub="in-review projects"
                  accent="#ffd740"
                />
                <StatCard
                  label="Total Journal Hours"
                  value={fmt(stats.hours.totalJournalHours)}
                  sub="all journal entries"
                  accent="#c9a87c"
                />
              </div>
            </section>

            {/* Coins */}
            <section className="astat-section">
              <h2 className="astat-section-title">Coins (Currency)</h2>
              <div className="astat-grid">
                <StatCard
                  label="Total Coins Earned"
                  value={fmt(stats.coins.totalEarned, 0)}
                  sub="from approved projects"
                  accent="#ffd740"
                />
                <StatCard
                  label="Coins in Wallets"
                  value={fmt(stats.coins.inWallets, 0)}
                  sub="users' current balances"
                  accent="#9cffcf"
                />
                <StatCard
                  label="Coins Spent"
                  value={fmt(stats.coins.spent, 0)}
                  sub="via shop purchases"
                  accent="#ff8fab"
                />
              </div>
            </section>

            {/* Users */}
            <section className="astat-section">
              <h2 className="astat-section-title">Users</h2>
              <div className="astat-grid">
                <StatCard label="Total Users" value={stats.users.total} accent="#d6a47a" />
                <StatCard
                  label="Reviewers / Staff"
                  value={stats.users.reviewers}
                  sub="reviewer + admin + superadmin"
                  accent="#c9a87c"
                />
                <StatCard
                  label="Users with Projects"
                  value={stats.users.withProjects}
                  sub="at least one project"
                  accent="#ffd740"
                />
                <StatCard
                  label="Users with Approved Projects"
                  value={stats.users.withApprovedProjects}
                  sub="at least one approval"
                  accent="#9cffcf"
                />
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
