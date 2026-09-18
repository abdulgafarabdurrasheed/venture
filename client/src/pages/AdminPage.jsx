import { useAuth } from "../auth/AuthContext.jsx";
import "./AdminPage.css";

const adminLinks = [
  { href: "/admin/stats", icon: "📊", title: "Platform Statistics", desc: "Overview of projects, hours, users, and shop activity" },
  { href: "/admin/users", icon: "👥", title: "Users", desc: "Bolts, projects, hours, journals, and shop activity per participant" },
  { href: "/journaling", icon: "📓", title: "Journal Entries", desc: "Open the password-protected external journal review page" },
  { href: "/api/admin/journals.csv", icon: "🧾", title: "Journal entries (CSV)", desc: "All journal rows in one spreadsheet, sorted by project then time" },
  { href: "/admin/review", icon: "📋", title: "Project Review", desc: "Review shipped projects and approve hours" },
  { href: "/admin/shop", icon: "🛒", title: "Shop Admin", desc: "Manage catalog, categories, and pricing" },
  { href: "/admin/shop/orders", icon: "📦", title: "Shop orders", desc: "Fulfillment queue, group by user or item, refunds" },
];

const superAdminLinks = [
  { href: "/admin/airtable_sync", icon: "🔄", title: "Airtable Sync", desc: "Sync status, logs, and diagnostics" },
];

export function AdminPage() {
  const { user } = useAuth();
  const showSuperAdmin = user?.role === "superadmin";
  const links = showSuperAdmin ? [...adminLinks, ...superAdminLinks] : adminLinks;

  return (
    <main className="admin-page" aria-label="Admin page">
      <section className="admin-content">
        <a className="admin-back-link" href="/projects">
          ← Back to platform
        </a>
        <h1>Admin Panel</h1>

        <div className="admin-links">
          {links.map((item) => (
            <a key={item.href} href={item.href} className="admin-link">
              <span className="admin-link-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>
                {item.title}
                <span className="admin-link-desc">{item.desc}</span>
              </span>
            </a>
          ))}
        </div>

        {showSuperAdmin ? (
          <section className="admin-super">
            <div className="admin-super-icon">✦</div>
            <div className="admin-super-copy">
              <strong>Super admin</strong>
              <span>Additional tools - coming soon</span>
            </div>
          </section>
        ) : null}

        <section className="admin-silly" aria-hidden="true">
          <pre>{`(\\_/)\n(o.o)\n(> <)`}</pre>
          <p className="admin-emojis">🦄🌈🔮💎🎪🎭🎨🎬🎤🎧🎼🎹🥁🎷🎺🎸🪕🎻🎲🎯🎳🎮🎰🎱🔮💎🌈🦄</p>
          <p className="admin-tagline">sillies be upon ye</p>
        </section>
      </section>
    </main>
  );
}
