import { useCallback, useEffect, useRef, useState } from "react";
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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const rootRef = useRef(null);

  const coins = typeof user?.coins === "number" ? user.coins : 0;
  const hours = Math.round(Number(user?.loggedHours) || 0);
  const name = displayName(user);
  const role = user?.role;
  const showAdminLink = canFullAdmin(role);
  const showReviewLink = isReviewerOnly(role);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    setNotificationsLoading(true);
    try {
      const response = await apiFetch("/api/notifications");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load notifications.");
      setNotifications(Array.isArray(data) ? data : []);
      setNotificationsError("");
    } catch (error) {
      setNotificationsError(error.message || "Could not load notifications.");
    } finally {
      setNotificationsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    function onDocClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setMenuOpen(false);
        setNotificationsOpen(false);
      }
    }

    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    loadNotifications();
    const interval = window.setInterval(loadNotifications, 60_000);
    const handleFocus = () => loadNotifications();
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadNotifications, user]);

  async function markNotificationRead(notificationId) {
    setNotificationsError("");
    try {
      const response = await apiFetch(`/api/notifications/${notificationId}/read`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not mark notification as read.");
      setNotifications((current) => current.filter((notification) => notification.id !== notificationId));
    } catch (error) {
      setNotificationsError(error.message || "Could not mark notification as read.");
    }
  }

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

      <div className="platform-notifications">
        <button
          type="button"
          className="platform-notifications__trigger"
          onClick={(event) => {
            event.stopPropagation();
            setNotificationsOpen((open) => !open);
            setMenuOpen(false);
            if (!notificationsOpen) loadNotifications();
          }}
          aria-label={`Notifications, ${notifications.length} unread`}
          aria-expanded={notificationsOpen}
          aria-controls="platform-notifications-panel"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
          </svg>
          {notifications.length > 0 ? <span className="platform-notifications__count">{notifications.length}</span> : null}
        </button>

        {notificationsOpen ? (
          <section
            className="platform-notifications__panel"
            id="platform-notifications-panel"
            aria-label="Notifications"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="platform-notifications__header">
              <strong>Notifications</strong>
              <button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications">
                ×
              </button>
            </header>
            {notificationsError ? <p className="platform-notifications__message is-error" role="alert">{notificationsError}</p> : null}
            {notificationsLoading && notifications.length === 0 ? (
              <p className="platform-notifications__message">Loading…</p>
            ) : notifications.length === 0 ? (
              <p className="platform-notifications__message">You&apos;re all caught up.</p>
            ) : (
              <ul className="platform-notifications__list">
                {notifications.map((notification) => (
                  <li key={notification.id} className="platform-notifications__item">
                    <p>{notification.message}</p>
                    <time dateTime={notification.created_at}>
                      {notification.created_at ? new Date(notification.created_at).toLocaleString() : ""}
                    </time>
                    <button type="button" onClick={() => markNotificationRead(notification.id)}>
                      Mark as read
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

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
