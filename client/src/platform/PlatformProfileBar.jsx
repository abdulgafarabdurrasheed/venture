import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import pfpBar from "@assets/common_to_pages/pfp_bar.png";
import { ShipCountdown } from "../components/ShipCountdown.jsx";
import { displayName } from "./displayName.js";
import "./PlatformProfileBar.css";

function canFullAdmin(role) {
  return role === "admin" || role === "superadmin";
}

function isReviewerOnly(role) {
  return role === "reviewer";
}

export function PlatformProfileBar() {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef(null);

  const coins = typeof user?.coins === "number" ? user.coins : 0;
  const hours = Math.round(Number(user?.loggedHours) || 0);
  const name = displayName(user);
  const role = user?.role;
  const showAdminLink = canFullAdmin(role);
  const showReviewLink = isReviewerOnly(role);

  useEffect(() => {
    function onDocClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  async function handleLogout() {
    setMenuOpen(false);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Still send the user home even if the API round-trip fails.
    }
    window.location.href = "/";
  }

  return (
    <div className="platform-pfp-bar-wrap" ref={rootRef}>
      <ShipCountdown variant="bar" />

      <div className="platform-pfp-bar">
        <img className="platform-pfp-bar__frame" src={pfpBar} alt="" aria-hidden="true" />

        {user?.profileImageUrl ? (
          <img className="platform-pfp-bar__avatar" src={user.profileImageUrl} alt="" draggable={false} />
        ) : null}

        <div className="platform-pfp-bar__info">
          <p className="platform-pfp-bar__name">{name}</p>
          <p className="platform-pfp-bar__meta">Hours: {hours}</p>
          <p className="platform-pfp-bar__meta">Coins: {coins}</p>
        </div>

        <button
          type="button"
          className="platform-pfp-bar__trigger"
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Account menu"
        />

        {menuOpen ? (
          <div className="platform-pfp-bar__menu" role="menu">
            {showAdminLink ? (
              <a className="platform-pfp-bar__menu-item" role="menuitem" href="/admin">
                Admin Panel
              </a>
            ) : null}
            {showReviewLink ? (
              <a className="platform-pfp-bar__menu-item" role="menuitem" href="/admin/review">
                Project Review
              </a>
            ) : null}
            <button type="button" className="platform-pfp-bar__menu-item" role="menuitem" onClick={handleLogout}>
              Log out
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
