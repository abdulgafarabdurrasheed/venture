import { apiFetch } from "../api/client.js";
import { useEffect, useMemo, useState } from "react";
import "./AdminShopPage.css";

function formatUsd(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : "—";
}

function formatDate(value) {
  if (!value) return "Unknown date";
  return new Date(value).toLocaleString();
}

function orderStatus(order) {
  if (order.rejected) return "rejected";
  if (order.fulfilled) return "fulfilled";
  return "pending";
}

function orderUsdTotal(order) {
  const stored = Number(order.totalUsd);
  if (Number.isFinite(stored)) return stored;
  const itemUsd = Number(order.itemPriceUsd);
  if (!Number.isFinite(itemUsd)) return null;
  return itemUsd * Number(order.quantity ?? 1);
}

function groupLabel(groupBy, key) {
  if (groupBy === "user") return `Customer: ${key}`;
  if (groupBy === "item") return `Item: ${key}`;
  return "Flat list";
}

export function AdminShopOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [groupBy, setGroupBy] = useState("flat");
  const [sortOrder, setSortOrder] = useState("newest");

  useEffect(() => {
    async function loadOrders() {
      try {
        const response = await apiFetch("/api/admin/shop/orders", { credentials: "include" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load orders.");
        setOrders(data.orders || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadOrders();
  }, []);

  async function markAsFulfilled(orderId) {
    try {
      const response = await apiFetch(`/api/admin/shop/orders/${orderId}/fulfill`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to fulfill order.");

      setOrders((prev) =>
        prev.map((order) => (order.id === orderId ? { ...order, fulfilled: true } : order))
      );
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }

  async function rejectOrder(order) {
    const ok = window.confirm(`Reject order #${order.id} and refund ${Number(order.totalCoins ?? 0)} coins?`);
    if (!ok) return;

    try {
      const response = await apiFetch(`/api/admin/shop/orders/${order.id}/reject`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to reject order.");

      setOrders((prev) =>
        prev.map((current) => (current.id === order.id ? { ...current, rejected: true } : current))
      );
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }

  const visibleOrders = useMemo(() => {
    const filtered = orders.filter((order) => statusFilter === "all" || orderStatus(order) === statusFilter);
    return [...filtered].sort((a, b) => {
      if (sortOrder === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
      if (sortOrder === "bricks-high") return Number(b.totalCoins ?? 0) - Number(a.totalCoins ?? 0);
      if (sortOrder === "usd-high") return Number(orderUsdTotal(b) ?? -1) - Number(orderUsdTotal(a) ?? -1);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [orders, sortOrder, statusFilter]);

  const groupedOrders = useMemo(() => {
    if (groupBy === "flat") return [["all", visibleOrders]];

    const groups = visibleOrders.reduce((acc, order) => {
      const key = groupBy === "item" ? order.itemName || "Unknown item" : order.email || "Unknown customer";
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key).push(order);
      return acc;
    }, new Map());

    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [groupBy, visibleOrders]);

  return (
    <main className="admin-shop-page">
      <section className="admin-shop-content">
        <a href="/admin/shop" className="admin-shop-back">
          ← Shop catalog & items
        </a>
        <h1>Shop orders</h1>

        {error && <p className="admin-shop-error">{error}</p>}
        {loading && <p>Loading orders...</p>}

        {!loading && !error && orders.length === 0 && <p>No orders yet.</p>}

        {!loading && !error && orders.length > 0 && (
          <>
            <div className="admin-shop-order-controls">
              <label>
                Status
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="pending">Pending queue</option>
                  <option value="fulfilled">Fulfilled</option>
                  <option value="rejected">Rejected/refunded</option>
                  <option value="all">All orders</option>
                </select>
              </label>
              <label>
                Group by
                <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
                  <option value="flat">Flat list</option>
                  <option value="user">Customer</option>
                  <option value="item">Item</option>
                </select>
              </label>
              <label>
                Queue order
                <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="bricks-high">Most coins first</option>
                  <option value="usd-high">Highest $ first</option>
                </select>
              </label>
              <span className="admin-shop-order-count">
                {visibleOrders.length} cards · {orders.length} DB rows
              </span>
            </div>

            {visibleOrders.length === 0 ? <p>No orders match this view.</p> : null}

            <div className="admin-shop-orders">
              {groupedOrders.map(([key, groupOrders]) => (
                <section key={key} className="admin-shop-order-group">
                  {groupBy !== "flat" ? <h2>{groupLabel(groupBy, key)}</h2> : null}
                  <div className="admin-shop-order-cards">
                    {groupOrders.map((order) => {
                      const status = orderStatus(order);
                      const isActionable = status === "pending";
                      return (
                        <article key={order.id} className={`admin-shop-order-card is-${status}`}>
                          <div className="admin-shop-order-card-main">
                            <span className={`status-badge ${status}`}>{status}</span>
                            <h2>{order.itemName || "Unknown item"}</h2>
                            <p>
                              Purchase: {formatUsd(orderUsdTotal(order))} · {Number(order.totalCoins ?? 0)} coins
                            </p>
                            <div className="admin-shop-order-money">
                              <span>Amount requested: {formatUsd(orderUsdTotal(order))}</span>
                              <span>Coins charged: {Number(order.totalCoins ?? 0)}</span>
                            </div>

                            <div className="admin-shop-order-customer">
                              <strong>Customer</strong>
                              <span>Email: {order.email || "Unknown"}</span>
                              <span>User ID: #{order.userId}</span>
                            </div>

                            {order.itemUsage ? (
                              <div className="admin-shop-order-usage">
                                <strong>Grant usage</strong>
                                <p>{order.itemUsage}</p>
                              </div>
                            ) : (
                              <div className="admin-shop-order-usage admin-shop-order-usage--missing">
                                <strong>Grant usage</strong>
                                <p>No usage description provided.</p>
                              </div>
                            )}

                            <footer>
                              <span>DB row: #{order.id}</span>
                              <span>Created: {formatDate(order.createdAt)}</span>
                            </footer>
                          </div>

                          <div className="admin-shop-order-card-actions">
                            <button type="button" disabled={!isActionable} onClick={() => markAsFulfilled(order.id)}>
                              ✓ Mark fulfilled
                            </button>
                            <button type="button" disabled={!isActionable} className="danger" onClick={() => rejectOrder(order)}>
                              × Reject (refund coins)
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
