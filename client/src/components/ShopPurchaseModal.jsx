import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../api/client.js";
import { formatCoins, formatUsd } from "../constants/coinRates.js";
import { resolveShopItemImage } from "../utils/shopItemImages.js";
import "./ShopPurchaseModal.css";

const GRANT_ACKNOWLEDGMENTS = [
  "I acknowledge that by receiving this grant I will be issued an HCB prepaid card, which may only be used for the purchase of the specified item(s) for the purpose of my own travel.",
  "I confirm that all expenses made with this grant are strictly for personal use and may not be used to cover costs for other individuals, including friends, family members, or any third parties.",
  "I understand that any violation of these rules may result in permanent removal from the Hack Club ecosystem and may be treated as fraudulent activity.",
  "I understand that Hack Club is not responsible for any aspect of my travel, safety, or experiences, and that this grant solely provides financial support for my adventure.",
];

function emptyAcknowledgments() {
  return Object.fromEntries(GRANT_ACKNOWLEDGMENTS.map((_, index) => [index, false]));
}

export function ShopPurchaseModal({ item, userCoins, onClose, onPurchased }) {
  const [itemUsage, setItemUsage] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [acknowledgments, setAcknowledgments] = useState(emptyAcknowledgments);

  useEffect(() => {
    setItemUsage("");
    setMessage("");
    setSubmitting(false);
    setShowConfirm(false);
    setAcknowledgments(emptyAcknowledgments());
  }, [item?.id]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key !== "Escape") return;
      if (showConfirm) {
        setShowConfirm(false);
        setAcknowledgments(emptyAcknowledgments());
        return;
      }
      onClose?.();
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, showConfirm]);

  if (!item) return null;

  const grantAmountUsd = Number(item.priceUsd);
  const totalCoins = Number(item.price);
  const hasFixedOffer =
    Number.isFinite(grantAmountUsd) && grantAmountUsd > 0 && Number.isFinite(totalCoins) && totalCoins > 0;
  const availableCoins = Number(userCoins) || 0;
  const hasEnoughCoins = hasFixedOffer && availableCoins >= totalCoins;
  const hasItemUsage = itemUsage.trim().length > 0;
  const canPurchase = hasFixedOffer && hasEnoughCoins && hasItemUsage && !submitting;
  const allAcknowledged = GRANT_ACKNOWLEDGMENTS.every((_, index) => acknowledgments[index]);

  function handleBuyClick() {
    if (!canPurchase) return;
    setMessage("");
    setShowConfirm(true);
  }

  function handleBackFromConfirm() {
    setShowConfirm(false);
    setAcknowledgments(emptyAcknowledgments());
  }

  function toggleAcknowledgment(index) {
    setAcknowledgments((current) => ({ ...current, [index]: !current[index] }));
  }

  async function handleConfirmPurchase() {
    if (!canPurchase || !allAcknowledged || submitting) return;

    setMessage("");
    setSubmitting(true);
    try {
      const response = await apiFetch(`/api/shop/items/${item.id}/buy`, {
        method: "POST",
        body: JSON.stringify({ itemUsage: itemUsage.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to buy item.");

      await onPurchased?.(data.purchase);
      onClose?.();
    } catch (error) {
      setMessage(error.message || "Failed to buy item.");
      setShowConfirm(false);
      setAcknowledgments(emptyAcknowledgments());
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

        <div className="shop-modal__row">
          <span>Fixed grant amount</span>
          <strong>{hasFixedOffer ? formatUsd(grantAmountUsd) : "Not configured"}</strong>
        </div>

        <label className="shop-modal__field">
          <span>What specific purchase will this grant cover? *</span>
          <textarea
            required
            rows={4}
            maxLength={2000}
            placeholder="Describe the item or expense this grant will cover."
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
          <strong>{hasFixedOffer ? `${formatCoins(totalCoins)} coins` : "—"}</strong>
        </div>

        {!hasFixedOffer ? (
          <p className="shop-modal__warning">This offer is not configured with a fixed grant amount and coin cost.</p>
        ) : null}
        {hasFixedOffer && !hasEnoughCoins ? (
          <p className="shop-modal__warning">
            Not enough coins to claim this offer. You have {formatCoins(availableCoins)} coins and it costs{" "}
            {formatCoins(totalCoins)}.
          </p>
        ) : null}
        {hasFixedOffer && hasEnoughCoins && !hasItemUsage ? (
          <p className="shop-modal__warning">Describe the specific purchase this grant will cover.</p>
        ) : null}
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
                Before completing your purchase, please read and acknowledge each statement below.
              </p>

              <ul className="shop-modal__confirm-list">
                {GRANT_ACKNOWLEDGMENTS.map((text, index) => (
                  <li key={text}>
                    <label className="shop-modal__confirm-item">
                      <input
                        type="checkbox"
                        checked={Boolean(acknowledgments[index])}
                        onChange={() => toggleAcknowledgment(index)}
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
