import { formatCoins, formatUsd } from "../constants/coinRates.js";
import "./ShopOrderRow.css";

const STATUS_LABELS = {
  pending: "Pending",
  issued: "Grant issued · fulfillment pending",
  fulfilled: "Fulfilled",
  rejected: "Rejected",
};

export function ShopOrderRow({ order }) {
  const status = order.status || (order.grantIssuedAt ? "issued" : "pending");
  const label = STATUS_LABELS[status] || STATUS_LABELS.pending;

  return (
    <article className={`shop-order-row shop-order-row--${status}`}>
      <div className="shop-order-row__details">
        <p className="shop-order-row__name">{order.itemName || "Item"}</p>
        <p className="shop-order-row__qty">
          Grant: {order.totalUsd != null ? formatUsd(order.totalUsd) : "—"} · Cost: {formatCoins(order.totalCoins ?? 0)} coins
        </p>
      </div>
      <div className="shop-order-row__status">{label}</div>
    </article>
  );
}
