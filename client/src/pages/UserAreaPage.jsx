import { useEffect, useState } from "react";
import pfpPic from "@assets/common_to_pages/pfp_pic.png";
import { apiFetch } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { ShopOrderRow } from "../components/ShopOrderRow.jsx";
import { PlatformLayout } from "../platform/PlatformLayout.jsx";
import { displayName } from "../platform/displayName.js";
import "./UserAreaPage.css";

async function readApiJson(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("Profile API is unavailable. Restart the server and try again.");
  }
  return response.json();
}

function formatHourStat(value) {
  const hours = Number(value) || 0;
  const rounded = Number.isInteger(hours) ? hours : Number(hours.toFixed(1));
  return `${rounded}h`;
}

export function UserAreaPage() {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, stats: null, orders: [], error: "" });
  const name = displayName(user).toUpperCase();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await apiFetch("/api/user/dashboard");
        const data = await readApiJson(response);
        if (!response.ok) throw new Error(data.error || "Failed to load profile.");
        if (!cancelled) {
          setState({
            loading: false,
            stats: data.stats || null,
            orders: data.orders || [],
            error: "",
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ loading: false, stats: null, orders: [], error: error.message || "Failed to load profile." });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = state.stats || {
    loggedHours: 0,
    approvedHours: 0,
    rejectedHours: 0,
    orderCount: 0,
    totalProjects: 0,
  };

  return (
    <PlatformLayout activeTab="user" contentClassName="platform-frame__content--user">
      {state.loading ? <p className="platform-message">Loading profile…</p> : null}
      {state.error ? <p className="platform-message platform-message--error">{state.error}</p> : null}

      {!state.loading && !state.error ? (
        <div className="user-page">
          <div className="user-page__board">
            <div className="user-page__profile-group">
              <section className="user-page__profile" aria-label="Profile">
                <img
                  className="user-page__avatar"
                  src={user?.profileImageUrl || pfpPic}
                  alt=""
                  draggable={false}
                />
                <p className="user-page__name">{name}</p>
              </section>

              <section className="user-page__stats" aria-label="Statistics">
              <p>
                <span>Logged hours:</span> {formatHourStat(stats.loggedHours)}
              </p>
              <p>
                <span>Approved hours:</span> {formatHourStat(stats.approvedHours)}
              </p>
              <p>
                <span>Rejected hours:</span> {formatHourStat(stats.rejectedHours)}
              </p>
              <p className="user-page__stats-gap" aria-hidden="true" />
              <p>
                <span>Orders number:</span> {stats.orderCount}
              </p>
              <p>
                <span>Total projects:</span> {stats.totalProjects}
              </p>
              </section>
            </div>

            <section className="user-page__orders" aria-label="Shop orders">
              <h2 className="user-page__orders-title">Shop orders:</h2>
              {state.orders.length === 0 ? (
                <p className="user-page__orders-empty">No orders yet.</p>
              ) : (
                <div className="user-page__orders-list">
                  {state.orders.map((order) => (
                    <ShopOrderRow key={order.id} order={order} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      ) : null}
    </PlatformLayout>
  );
}
