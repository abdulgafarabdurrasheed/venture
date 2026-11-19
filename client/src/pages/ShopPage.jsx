import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { ShopItemCard } from "../components/ShopItemCard.jsx";
import { ShopPurchaseModal } from "../components/ShopPurchaseModal.jsx";
import { PlatformLayout } from "../platform/PlatformLayout.jsx";
import "./ShopPage.css";

const ITEMS_PER_PAGE = 4;

export function ShopPage() {
  const { user, reload } = useAuth();
  const [state, setState] = useState({ loading: true, items: [], error: "" });
  const [page, setPage] = useState(0);
  const [selectedItem, setSelectedItem] = useState(null);
  const [purchaseMessage, setPurchaseMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/shop/items", {
          credentials: "include",
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load shop items.");
        if (!cancelled) setState({ loading: false, items: data.items || [], error: "" });
      } catch (error) {
        if (!cancelled) {
          setState({ loading: false, items: [], error: error.message || "Failed to load shop items." });
        }
      }
    }

    load();

    function handleFocus() {
      load();
    }

    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  useEffect(() => {
    if (state.loading || state.error) return;
    const params = new URLSearchParams(window.location.search);
    const addressResult = params.get("grant_address");
    const itemId = params.get("item");
    const messages = {
      connected: "Hack Club address connected. Review the grant and submit your request.",
      incomplete: "Hack Club did not return a complete mailing address. Check your Hack Club account and retry.",
      identity_mismatch: "The connected Hack Club account does not match your Off-Track account.",
      login_required: "Your Off-Track session expired. Sign in again, then reconnect your address.",
      cancelled: "Address connection was cancelled. You can retry from the grant form.",
      unavailable: "Address connection is unavailable right now. Please try again later.",
      error: "Address connection failed. Please try again.",
    };
    if (addressResult && messages[addressResult]) setPurchaseMessage(messages[addressResult]);
    if (itemId) {
      const item = state.items.find((entry) => String(entry.id) === itemId);
      if (item) setSelectedItem(item);
    }
    if (addressResult || itemId) {
      params.delete("grant_address");
      params.delete("item");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }, [state.error, state.items, state.loading]);

  const pageCount = Math.max(1, Math.ceil(state.items.length / ITEMS_PER_PAGE));

  const visibleItems = useMemo(() => {
    const start = page * ITEMS_PER_PAGE;
    return state.items.slice(start, start + ITEMS_PER_PAGE);
  }, [page, state.items]);

  const hasPagination = !state.loading && !state.error && state.items.length > ITEMS_PER_PAGE;
  const showNext = hasPagination && page < pageCount - 1;
  const showPrev = hasPagination && page > 0;

  useEffect(() => {
    if (page > pageCount - 1) {
      setPage(Math.max(0, pageCount - 1));
    }
  }, [page, pageCount]);

  function handleNext() {
    setPage((current) => Math.min(pageCount - 1, current + 1));
  }

  function handlePrev() {
    setPage((current) => Math.max(0, current - 1));
  }

  const handlePurchased = useCallback(
    async (purchase) => {
      await reload?.();
      const usd = purchase?.totalUsd ?? purchase?.amountUsd;
      const coins = purchase?.totalCoins;
      const detail =
        usd != null && coins != null
          ? ` (${Number(usd).toFixed(2)} → ${coins} coins)`
          : "";
      setPurchaseMessage(`Purchased ${purchase?.item?.name || "item"}${detail}.`);
    },
    [reload]
  );

  return (
    <PlatformLayout
      activeTab="shop"
      contentClassName="platform-frame__content--shop"
      showNext={showNext}
      onNext={handleNext}
      nextLabel="Next shop page"
      showPrev={showPrev}
      onPrev={handlePrev}
      prevLabel="Previous shop page"
    >
      {state.loading ? <p className="platform-message">Loading shop…</p> : null}
      {state.error ? <p className="platform-message platform-message--error">{state.error}</p> : null}
      {purchaseMessage ? <p className="platform-message">{purchaseMessage}</p> : null}

      {!state.loading && !state.error ? (
        <div className="shop-page">
          {state.items.length === 0 ? (
            <p className="platform-message">No shop items available yet.</p>
          ) : (
            <div className="shop-page__grid">
              {visibleItems.map((item) => (
                <ShopItemCard key={item.id} item={item} onOpen={setSelectedItem} />
              ))}
            </div>
          )}
        </div>
      ) : null}

      <ShopPurchaseModal
        item={selectedItem}
        userCoins={user?.coins}
        onClose={() => setSelectedItem(null)}
        onPurchased={handlePurchased}
      />
    </PlatformLayout>
  );
}
