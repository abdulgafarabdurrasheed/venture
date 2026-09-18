import { useAuth } from "../auth/AuthContext.jsx";
import { apiFetch } from "../api/client.js";
import "../platform/platform.css";

const NAV_LINKS = [
  { href: "/projects", label: "Projects" },
  { href: "/shop", label: "Shop" },
  { href: "/user", label: "Profile" },
  { href: "/faq", label: "FAQ" },
  { href: "/admin", label: "Admin" },
];

export function PlatformShell({ title, children }) {
  const { user, reload } = useAuth();

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    await reload();
    window.location.href = "/login";
  }

  return (
    <main className="platform-page">
      <div className="platform-status">
        <span>
          Signed in as <strong>{user?.name || user?.email || "Unknown user"}</strong>
        </span>
        {typeof user?.coins === "number" ? <span>Coins: {user.coins}</span> : null}
        <span className="platform-muted">Role: {user?.role || "member"}</span>
        <button type="button" onClick={handleLogout}>
          Log out
        </button>
      </div>

      <nav className="platform-nav" aria-label="Platform navigation">
        {NAV_LINKS.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
        <a href="/">Landing</a>
        <a href="/rules">Rules</a>
      </nav>

      <h1>{title}</h1>
      {children}
    </main>
  );
}
