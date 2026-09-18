import { apiFetch } from "../api/client.js";
import { useEffect, useState } from "react";
import { COINS_PER_APPROVED_HOUR, COINS_PER_USD, USD_PER_APPROVED_HOUR } from "../constants/coinRates.js";
import { CDN_UPLOAD_HELP, isHackClubCdnUrl, normalizeHackClubCdnUrl } from "../utils/cdnLinks.js";
import { shopItemPayload } from "../utils/shopItemPayload.js";
import { DEFAULT_SHOP_LABEL_COLOR, SHOP_LABEL_COLORS } from "../constants/shopLabelColors.js";
import "./AdminShopPage.css";

const emptyForm = {
  name: "",
  frameLabel: "",
  frameLabelColor: DEFAULT_SHOP_LABEL_COLOR,
  discountPercent: "",
  maxPerPerson: "",
  itemLink: "",
  imageUrl: "",
  description: "",
  active: true,
};

function sortShopItems(items) {
  return [...items].sort((a, b) => {
    const positionDiff = Number(a.position ?? 0) - Number(b.position ?? 0);
    if (positionDiff !== 0) return positionDiff;
    return Number(a.id) - Number(b.id);
  });
}

export function AdminShopPage() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingItem, setEditingItem] = useState(null);
  const [showInactive, setShowInactive] = useState(true);
  const [status, setStatus] = useState("Loading shop items...");
  const [error, setError] = useState("");
  const [reordering, setReordering] = useState(false);

  const sortedItems = sortShopItems(items);
  const visibleItems = showInactive ? sortedItems : sortedItems.filter((item) => item.active);

  useEffect(() => {
    loadItems();
  }, []);

  async function loadItems() {
    setStatus("Loading shop items...");
    setError("");
    try {
      const response = await apiFetch("/api/admin/shop/items", { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load shop items.");
      setItems(data.items || []);
      setStatus("");
    } catch (err) {
      setError(err.message);
      setStatus("");
    }
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleAddItem(event) {
    event.preventDefault();
    setError("");
    try {
      const response = await apiFetch("/api/admin/shop/items", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shopItemPayload(form)),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create item.");
      setForm(emptyForm);
      await loadItems();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdateItem(event) {
    event.preventDefault();
    if (!editingItem) return;
    setError("");
    try {
      const response = await apiFetch(`/api/admin/shop/items/${editingItem.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shopItemPayload(editingItem)),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update item.");
      setEditingItem(null);
      await loadItems();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleItem(item) {
    const response = await apiFetch(`/api/admin/shop/items/${item.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shopItemPayload({ ...item, active: !item.active })),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Failed to update item.");
      return;
    }
    await loadItems();
  }

  async function deleteItem(item) {
    if (!window.confirm(`Delete ${item.name || "this item"}?`)) return;
    const response = await apiFetch(`/api/admin/shop/items/${item.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : {};
    if (!response.ok) {
      setError(data.error || "Failed to delete item.");
      return;
    }
    await loadItems();
  }

  async function bulkActive(active) {
    const response = await apiFetch("/api/admin/shop/items/bulk_active", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Failed to update items.");
      return;
    }
    await loadItems();
  }

  async function moveItem(itemId, direction) {
    const ordered = sortShopItems(items);
    const index = ordered.findIndex((item) => item.id === itemId);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return;

    const nextOrder = ordered.map((item) => item.id);
    [nextOrder[index], nextOrder[swapIndex]] = [nextOrder[swapIndex], nextOrder[index]];

    setReordering(true);
    setError("");
    try {
      const response = await apiFetch("/api/admin/shop/items/reorder", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: nextOrder }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to reorder items.");
      setItems(data.items || []);
    } catch (err) {
      setError(err.message);
      await loadItems();
    } finally {
      setReordering(false);
    }
  }

  return (
    <main className="admin-shop-page">
      <section className="admin-shop-content">
        <a href="/admin" className="admin-shop-back">
          ← Admin Panel
        </a>
        <h1>Shop Admin</h1>

        <p className="admin-shop-pricing-note">
          Items have no fixed price. At checkout, participants enter how much they need in dollars. The platform
          charges coins at ${USD_PER_APPROVED_HOUR}/approved hour ({COINS_PER_APPROVED_HOUR} coins/hour, {COINS_PER_USD}{" "}
          coins per $1). Use the order controls to set shop display order, and add a frame label for each item shown on
          the shop card.
        </p>

        <div className="admin-shop-orders-link">
          <a href="/admin/shop/orders">📦 Shop orders queue</a>
          <span>Fulfill purchases, refunds, and grouped pending lines.</span>
        </div>

        {error ? <p className="admin-shop-error">{error}</p> : null}
        {status ? <p>{status}</p> : null}

        <section className="admin-shop-card">
          <h2>Add New Item</h2>
          <ShopItemForm
            value={form}
            submitLabel="Add Item"
            onChange={updateForm}
            onSubmit={handleAddItem}
          />
        </section>

        <section className="admin-shop-card">
          <div className="admin-shop-table-header">
            <h2>Shop Items ({items.length})</h2>
            <div className="admin-shop-actions">
              <button type="button" onClick={() => bulkActive(true)}>
                Activate all
              </button>
              <button type="button" onClick={() => bulkActive(false)}>
                Deactivate all
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                />
                Show deactivated items
              </label>
            </div>
          </div>

          <div className="admin-shop-table-wrap">
            <table className="admin-shop-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Frame label</th>
                  <th>Max / person</th>
                  <th>Discount</th>
                  <th>Link</th>
                  <th>Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan="9">No shop items yet.</td>
                  </tr>
                ) : (
                  visibleItems.map((item) => {
                    const fullIndex = sortedItems.findIndex((entry) => entry.id === item.id);
                    return (
                    <tr key={item.id} className={item.active ? "" : "is-inactive"}>
                      <td>
                        <div className="admin-shop-order-controls-cell">
                          <span className="admin-shop-order-index">{Number(item.position ?? 0) + 1}</span>
                          <div className="admin-shop-order-buttons">
                            <button
                              type="button"
                              disabled={reordering || fullIndex <= 0}
                              onClick={() => moveItem(item.id, -1)}
                              aria-label={`Move ${item.name || "item"} up`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={reordering || fullIndex >= sortedItems.length - 1}
                              onClick={() => moveItem(item.id, 1)}
                              aria-label={`Move ${item.name || "item"} down`}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      </td>
                      <td>{item.id}</td>
                      <td>{item.name || "—"}</td>
                      <td>{item.frameLabel || "—"}</td>
                      <td>{item.maxPerPerson ?? "None"}</td>
                      <td>{item.discountPercent ? `${item.discountPercent}% off` : "—"}</td>
                      <td>{item.itemLink ? <a href={item.itemLink} target="_blank" rel="noreferrer">View</a> : "—"}</td>
                      <td>{item.active ? "Yes" : "No"}</td>
                      <td>
                        <div className="admin-shop-row-actions">
                          <button type="button" onClick={() => setEditingItem(item)}>
                            Modify
                          </button>
                          <button type="button" onClick={() => toggleItem(item)}>
                            {item.active ? "Deactivate" : "Activate"}
                          </button>
                          <button type="button" onClick={() => deleteItem(item)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {editingItem ? (
        <div className="admin-shop-modal" role="presentation" onClick={() => setEditingItem(null)}>
          <section role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <button className="admin-shop-modal-close" type="button" onClick={() => setEditingItem(null)}>
              ×
            </button>
            <h2>Modify Item</h2>
            <ShopItemForm
              value={editingItem}
              submitLabel="Save Item"
              onChange={(field, value) => setEditingItem((current) => ({ ...current, [field]: value }))}
              onSubmit={handleUpdateItem}
            />
          </section>
        </div>
      ) : null}
    </main>
  );
}

function ShopItemForm({ value, submitLabel, onChange, onSubmit }) {
  const [imageLinkError, setImageLinkError] = useState("");

  function applyImageUrl(rawUrl) {
    const normalized = normalizeHackClubCdnUrl(rawUrl);
    if (!normalized) {
      if (String(rawUrl || "").trim()) {
        setImageLinkError("Paste a Hack Club CDN link from #cdn on Slack.");
      } else {
        setImageLinkError("");
      }
      return;
    }
    setImageLinkError("");
    onChange("imageUrl", normalized);
  }

  return (
    <form className="admin-shop-form" onSubmit={onSubmit}>
      <label>
        Name *
        <input value={value.name || ""} onChange={(event) => onChange("name", event.target.value)} required />
      </label>
      <div className="admin-shop-form-wide">
        <label>
          Frame label
          <input
            value={value.frameLabel || ""}
            onChange={(event) => onChange("frameLabel", event.target.value)}
            placeholder="e.g. Travel, Gear, Tickets"
          />
        </label>
        <p className="admin-shop-form-hint">
          Pill badge above the item image. Leave blank to hide the badge. Item name still shows below.
        </p>
        <fieldset className="admin-shop-label-colors">
          <legend>Label color</legend>
          <div className="admin-shop-label-colors__options">
            {SHOP_LABEL_COLORS.map((color) => (
              <label key={color.id} className="admin-shop-label-colors__option">
                <input
                  type="radio"
                  name={`frame-label-color-${value.id ?? "new"}`}
                  value={color.id}
                  checked={(value.frameLabelColor || DEFAULT_SHOP_LABEL_COLOR) === color.id}
                  onChange={() => onChange("frameLabelColor", color.id)}
                />
                <span className="admin-shop-label-colors__swatch" style={{ backgroundColor: color.hex }} />
                <span>{color.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <label>
        Discount %
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          placeholder="25"
          value={value.discountPercent || ""}
          onChange={(event) => onChange("discountPercent", event.target.value)}
        />
      </label>
      <label>
        Max purchases per person
        <input type="number" value={value.maxPerPerson || ""} onChange={(event) => onChange("maxPerPerson", event.target.value)} />
      </label>
      <label>
        Item Link
        <input value={value.itemLink || ""} onChange={(event) => onChange("itemLink", event.target.value)} />
      </label>
      <label className="admin-shop-form-wide">
        Item image
        <p className="admin-shop-form-hint">{CDN_UPLOAD_HELP}</p>
        <input
          type="url"
          placeholder="https://cdn.hackclub.com/…"
          value={value.imageUrl || ""}
          onChange={(event) => {
            onChange("imageUrl", event.target.value);
            setImageLinkError("");
          }}
          onBlur={(event) => applyImageUrl(event.target.value)}
        />
        {imageLinkError ? <p className="admin-shop-form-error">{imageLinkError}</p> : null}
        {isHackClubCdnUrl(value.imageUrl) ? (
          <img className="admin-shop-form-image-preview" src={value.imageUrl} alt="" />
        ) : null}
      </label>
      <label>
        Active
        <input type="checkbox" checked={Boolean(value.active)} onChange={(event) => onChange("active", event.target.checked)} />
      </label>
      <label className="admin-shop-form-wide">
        Description
        <textarea value={value.description || ""} onChange={(event) => onChange("description", event.target.value)} />
      </label>

      <button type="submit">{submitLabel}</button>
    </form>
  );
}
