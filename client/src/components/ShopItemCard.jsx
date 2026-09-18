import shopFrame from "@assets/landing_page/shop_section/shopFrame.png";
import buyBtn from "@assets/common_to_pages/buy_btn.png";
import { resolveShopItemImage } from "../utils/shopItemImages.js";
import { shopLabelColorHex } from "../constants/shopLabelColors.js";
import "./ShopItemCard.css";

function ShopItemTitle({ name }) {
  const words = String(name || "Shop item")
    .trim()
    .split(/\s+/);

  if (words.length === 2) {
    return (
      <h3 className="shop-item-card__title">
        <span className="shop-item-card__title-line">{words[0]}</span>
        <span className="shop-item-card__title-line">{words[1]}</span>
      </h3>
    );
  }

  return <h3 className="shop-item-card__title">{name || "Shop item"}</h3>;
}

function formatDiscount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric);
}

export function ShopItemCard({ item, onOpen, disabled }) {
  const discount = formatDiscount(item.discountPercent);
  const imageSrc = resolveShopItemImage(item);
  const usesCustomImage = Boolean(item?.imageUrl);
  const frameLabel = String(item.frameLabel || "").trim();
  const labelHex = item.frameLabelHex || shopLabelColorHex(item.frameLabelColor ?? item.frame_label_color);
  const labelIsDark = (item.frameLabelColor ?? item.frame_label_color) === "red";

  return (
    <article className="shop-item-card">
      <div className="shop-item-card__visual">
        {frameLabel ? (
          <span
            className="shop-item-card__badge"
            style={{ backgroundColor: labelHex, color: labelIsDark ? "#f5e6c8" : undefined }}
          >
            {frameLabel}
          </span>
        ) : null}

        <div className="shop-item-card__frame-wrap">
          <img className="shop-item-card__frame" src={shopFrame} alt="" aria-hidden="true" draggable={false} />

          {discount ? (
            <span className="shop-item-card__coin" aria-label={`${discount}% off`}>
              <span className="shop-item-card__coin-value">{discount}</span>
            </span>
          ) : null}

          <img
            className={`shop-item-card__item-image${usesCustomImage ? " shop-item-card__item-image--custom" : ""}`}
            src={imageSrc}
            alt=""
            aria-hidden="true"
            draggable={false}
          />

          <div className="shop-item-card__title-area">
            <ShopItemTitle name={item.name} />
          </div>

          <button
            type="button"
            className="shop-item-card__buy"
            onClick={() => onOpen?.(item)}
            disabled={disabled}
            aria-label={`Buy ${item.name}`}
          >
            <img src={buyBtn} alt="" draggable={false} />
          </button>
        </div>
      </div>
    </article>
  );
}
