import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../api/client.js";
import { formatCoins, formatUsd } from "../constants/coinRates.js";
import { resolveShopItemImage } from "../utils/shopItemImages.js";
import "./ShopPurchaseModal.css";

function emptyAcknowledgments(entries = []) {
  return Object.fromEntries(entries.map(({ id }) => [id, false]));
}

export function ShopPurchaseModal({ item, userCoins, onClose, onPurchased }) {
  const [itemUsage, setItemUsage] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [grantTerms, setGrantTerms] = useState({ loading: true, version: "", acknowledgments: [], error: "" });
  const [acknowledgments, setAcknowledgments] = useState({});

  useEffect(() => {
    setItemUsage("");
    setMessage("");
    setSubmitting(false);
    setShowConfirm(false);
    setAcknowledgments({});

    if (!item?.id) return undefined;
    let cancelled = false;
    setGrantTerms({ loading: true, version: "", acknowledgments: [], error: "" });
    apiFetch("/api/shop/grant-terms", { credentials: "include" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load grant terms.");
        if (cancelled) return;
        const entries = Array.isArray(data.acknowledgments) ? data.acknowledgments : [];
        setGrantTerms({ loading: false, version: data.version || "", acknowledgments: entries, error: "" });
        setAcknowledgments(emptyAcknowledgments(entries));
      })
      .catch((error) => {
        if (!cancelled) setGrantTerms({ loading: false, version: "", acknowledgments: [], error: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [item?.id]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape") return;
      if (showConfirm) {
        setShowConfirm(false);
        setAcknowledgments(emptyAcknowledgments(grantTerms.acknowledgments));
        return;
      }
      onClose?.();
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [grantTerms.acknowledgments, onClose, showConfirm]);

  if (!item) return null;

  const amountUsd = Number(item.priceUsd);
  const totalCoins = Number(item.price);
  const hasFixedPrice = Number.isFinite(amountUsd) && amountUsd > 0 && Number.isFinite(totalCoins) && totalCoins > 0;
  const availableCoins = Number(userCoins) || 0;
  const hasEnoughCoins = hasFixedPrice && availableCoins >= totalCoins;
  const hasItemUsage = itemUsage.trim().length > 0;
  const hasGrantTerms = Boolean(grantTerms.version) && grantTerms.acknowledgments.length > 0;
  const canPurchase = hasEnoughCoins && hasItemUsage && hasGrantTerms && !grantTerms.loading && !grantTerms.error && !submitting;
  const allAcknowledged = hasGrantTerms && grantTerms.acknowledgments.every(({ id }) => acknowledgments[id]);

  function handleBuyClick() {
    if (!canPurchase) return;
    setMessage("");
    setShowConfirm(true);
  }

  function handleBackFromConfirm() {
    setShowConfirm(false);
    setAcknowledgments(emptyAcknowledgments(grantTerms.acknowledgments));
  }

  function toggleAcknowledgment(id) {
    setAcknowledgments((current) => ({ ...current, [id]: !current[id] }));
  }

  async function handleConfirmPurchase() {
    if (!canPurchase || !allAcknowledged || submitting) return;

    setMessage("");
    setSubmitting(true);
    try {
      const response = await apiFetch(`/api/shop/items/${item.id}/buy`, {
        method: "POST",
        body: JSON.stringify({
          itemUsage: itemUsage.trim(),
          grantTermsVersion: grantTerms.version,
          acknowledgedIds: grantTerms.acknowledgments.filter(({ id }) => acknowledgments[id]).map(({ id }) => id),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to buy item.");

      await onPurchased?.(data.purchase);
      onClose?.();
    } catch (error) {
      setMessage(error.message || "Failed to buy item.");
      setShowConfirm(false);
      setAcknowledgments(emptyAcknowledgments(grantTerms.acknowledgments));
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="shop-modal__overlay" role="presentation" onClick={onClose}>
      <section
        className="shop-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} purchase`}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="shop-modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <img className="shop-modal__image" src={resolveShopItemImage(item)} alt="" />
        <h2 className="shop-modal__title">{item.name}</h2>
        <p className="shop-modal__description">{item.description || "Travel reward"}</p>

        <div className="shop-modal__row">
          <span>Grant amount</span>
          <strong>{hasFixedPrice ? formatUsd(amountUsd) : "Not configured"}</strong>
        </div>
        <div className="shop-modal__row">
          <span>Coin cost</span>
          <strong>{hasFixedPrice ? `${formatCoins(totalCoins)} coins` : "Not configured"}</strong>
        </div>

        {item.maxPerPerson ? (
          <div className="shop-modal__row">
            <span>Limit</span>
            <strong>{item.maxPerPerson} purchase(s) per person</strong>
          </div>
        ) : null}

        {item.itemLink ? (
          <a className="shop-modal__link" href={item.itemLink} target="_blank" rel="noreferrer">
            View item link
          </a>
        ) : null}

        <label className="shop-modal__field">
          <span>What will you specifically buy with this grant? *</span>
          <textarea
            required
            rows={4}
            maxLength={2000}
            placeholder="e.g. Round-trip train tickets from Milan to Florence for my project demo trip"
            value={itemUsage}
            onChange={(event) => setItemUsage(event.target.value)}
          />
        </label>

        <div className="shop-modal__row">
          <span>Your balance</span>
          <strong>{formatCoins(availableCoins)} coins</strong>
        </div>

        <div className="shop-modal__total">
          <span>Coins required</span>
          <strong>{hasFixedPrice ? `${formatCoins(totalCoins)} coins` : "—"}</strong>
        </div>

        {!hasFixedPrice ? (
          <p className="shop-modal__warning">This item is unavailable until staff configures its grant amount and coin cost.</p>
        ) : null}
        {hasFixedPrice && !hasEnoughCoins ? (
          <p className="shop-modal__warning">
            Not enough coins. You have {formatCoins(availableCoins)} coins, and this item costs {formatCoins(totalCoins)} coins.
          </p>
        ) : null}
        {hasEnoughCoins && !hasItemUsage ? (
          <p className="shop-modal__warning">Describe what you will buy with this grant before purchasing.</p>
        ) : null}
        {grantTerms.loading ? <p className="shop-modal__warning">Loading current grant terms…</p> : null}
        {grantTerms.error ? <p className="shop-modal__warning">{grantTerms.error}</p> : null}
        {message ? <p className="shop-modal__warning">{message}</p> : null}

        <button
          type="button"
          className="shop-modal__buy"
          disabled={!canPurchase}
          onClick={handleBuyClick}
        >
          Buy
        </button>

        {showConfirm ? (
          <div
            className="shop-modal__confirm-overlay"
            role="presentation"
            onClick={handleBackFromConfirm}
          >
            <section
              className="shop-modal__confirm"
              role="dialog"
              aria-modal="true"
              aria-label="Grant acknowledgment"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 className="shop-modal__confirm-title">Confirm your grant</h3>
              <p className="shop-modal__confirm-intro">
                Before submitting your request, please read and acknowledge each statement below.
              </p>
              <p className="shop-modal__confirm-intro">
                Staff review the request and record grant issuance separately. Submitting this order does not issue the grant.
              </p>

              <ul className="shop-modal__confirm-list">
                {grantTerms.acknowledgments.map(({ id, text }) => (
                  <li key={id}>
                    <label className="shop-modal__confirm-item">
                      <input
                        type="checkbox"
                        checked={Boolean(acknowledgments[id])}
                        onChange={() => toggleAcknowledgment(id)}
                      />
                      <span>{text}</span>
                    </label>
                  </li>
                ))}
              </ul>

              {!allAcknowledged ? (
                <p className="shop-modal__confirm-hint">Check all statements to continue.</p>
              ) : null}

              <div className="shop-modal__confirm-actions">
                <button type="button" className="shop-modal__confirm-back" onClick={handleBackFromConfirm}>
                  Back
                </button>
                <button
                  type="button"
                  className="shop-modal__buy"
                  disabled={!allAcknowledged || submitting}
                  onClick={handleConfirmPurchase}
                >
                  {submitting ? "Buying…" : "Confirm purchase"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </div>,
    document.body
  );
}
