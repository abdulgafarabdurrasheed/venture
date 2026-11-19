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
  const { user, reload } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState("account");
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [markingNotificationId, setMarkingNotificationId] = useState(null);
  const rootRef = useRef(null);
  const notificationRequestRef = useRef(0);
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;

  const coins = typeof user?.coins === "number" ? user.coins : 0;
  const stars = Number(user?.totalStars) || 0;
  const hours = Math.round(Number(user?.loggedHours) || 0);
  const name = displayName(user);
  const role = user?.role;
  const showAdminLink = canFullAdmin(role);
  const showReviewLink = isReviewerOnly(role);

  const loadNotifications = useCallback(async () => {
    const requestId = ++notificationRequestRef.current;
    const requestedUserId = user?.id;
    if (!user?.id) {
      setNotifications([]);
      setUnreadCount(0);
      setNotificationsError("");
      setNotificationsLoading(false);
      return;
    }

    setNotificationsLoading(true);
    setNotificationsError("");
    try {
      const response = await apiFetch("/api/notifications", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load notifications.");
      if (requestId !== notificationRequestRef.current || userIdRef.current !== requestedUserId) return;
      const list = Array.isArray(data) ? data : Array.isArray(data.notifications) ? data.notifications : [];
      setNotifications(list);
      setUnreadCount(Number.isFinite(Number(data.unreadCount)) ? Number(data.unreadCount) : list.length);
    } catch (error) {
      if (requestId === notificationRequestRef.current && userIdRef.current === requestedUserId) {
        setNotificationsError(error.message || "Failed to load notifications.");
      }
    } finally {
      if (requestId === notificationRequestRef.current && userIdRef.current === requestedUserId) {
        setNotificationsLoading(false);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    function onDocClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      setUnreadCount(0);
      return undefined;
    }

    loadNotifications();
    const interval = window.setInterval(loadNotifications, 45_000);
    window.addEventListener("focus", loadNotifications);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", loadNotifications);
    };
  }, [loadNotifications, user?.id]);

  async function markNotificationRead(notificationId) {
    const requestedUserId = user?.id;
    setMarkingNotificationId(notificationId);
    setNotificationsError("");
    try {
      const response = await apiFetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update notification.");
      if (userIdRef.current !== requestedUserId) return;
      setNotifications((current) => current.filter((notification) => notification.id !== notificationId));
      setUnreadCount((current) => Math.max(0, current - 1));
      if (notifications.find((notification) => notification.id === notificationId)?.type === "project_stars_updated") {
        void reload?.();
      }
    } catch (error) {
      if (userIdRef.current === requestedUserId) {
        setNotificationsError(error.message || "Failed to update notification.");
      }
    } finally {
      if (userIdRef.current === requestedUserId) setMarkingNotificationId(null);
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

      <div className="platform-pfp-bar">
        <img className="platform-pfp-bar__frame" src={pfpBar} alt="" aria-hidden="true" />

        {user?.profileImageUrl ? (
          <img className="platform-pfp-bar__avatar" src={user.profileImageUrl} alt="" draggable={false} />
        ) : null}

        <div className="platform-pfp-bar__info">
          <p className="platform-pfp-bar__name">{name}</p>
          <p className="platform-pfp-bar__meta">Hours: {hours}</p>
          <p className="platform-pfp-bar__meta">Coins: {coins}</p>
          <p className="platform-pfp-bar__meta">Stars: {stars}</p>
        </div>

        <button
          type="button"
          className="platform-pfp-bar__trigger"
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
            setMenuView("account");
          }}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Account menu"
        />

        {user?.id ? (
          <button
            type="button"
            className="platform-pfp-bar__inbox-trigger"
            onClick={() => {
              setMenuOpen(true);
              setMenuView("notifications");
              loadNotifications();
            }}
            aria-label={unreadCount ? `Open notifications, ${unreadCount} unread` : "Open notifications"}
            aria-expanded={menuOpen && menuView === "notifications"}
            title="Notifications"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
            </svg>
            {unreadCount > 0 ? (
              <span className="platform-pfp-bar__inbox-count">{unreadCount > 99 ? "99+" : unreadCount}</span>
            ) : null}
          </button>
        ) : null}

        {menuOpen ? (
          menuView === "notifications" ? (
            <section className="platform-pfp-bar__menu platform-pfp-bar__notifications" role="region" aria-label="Notifications">
              <header className="platform-pfp-bar__notifications-header">
                <button type="button" onClick={() => setMenuView("account")}>
                  ← Account
                </button>
                <strong>Notifications</strong>
                <span>{unreadCount} unread</span>
              </header>
              {notificationsError && notifications.length > 0 ? (
                <p className="platform-pfp-bar__notifications-error">{notificationsError}</p>
              ) : null}
              {notificationsLoading && notifications.length === 0 ? (
                <p className="platform-pfp-bar__notifications-empty">Loading…</p>
              ) : notificationsError && notifications.length === 0 ? (
                <p className="platform-pfp-bar__notifications-empty">
                  Notifications could not be loaded. <button type="button" onClick={loadNotifications}>Retry</button>
                </p>
              ) : notifications.length === 0 ? (
                <p className="platform-pfp-bar__notifications-empty">You&apos;re all caught up.</p>
              ) : (
                <ul className="platform-pfp-bar__notifications-list">
                  {notifications.map((notification) => {
                    const createdAt = new Date(notification.created_at);
                    const projectId = Number(notification.metadata?.projectId);
                    return (
                      <li className="platform-pfp-bar__notification" key={notification.id}>
                        <p>{notification.message}</p>
                        {Number.isNaN(createdAt.getTime()) ? null : (
                          <time dateTime={createdAt.toISOString()}>
                            {createdAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                          </time>
                        )}
                        <div className="platform-pfp-bar__notification-actions">
                          {Number.isInteger(projectId) && projectId > 0 ? (
                            <a href={`/projects?project=${encodeURIComponent(projectId)}`}>View project</a>
                          ) : <span />}
                          <button
                            type="button"
                            disabled={markingNotificationId === notification.id}
                            onClick={() => markNotificationRead(notification.id)}
                          >
                            {markingNotificationId === notification.id ? "Saving…" : "Mark read"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : (
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
          )
        ) : null}
      </div>
    </div>
  );
}
