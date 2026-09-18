import { DEFAULT_SHOP_LABEL_COLOR } from "../constants/shopLabelColors.js";

export function shopItemPayload(source = {}) {
  return {
    name: source.name,
    frameLabel: source.frameLabel ?? "",
    frameLabelColor: source.frameLabelColor || DEFAULT_SHOP_LABEL_COLOR,
    discountPercent: source.discountPercent ?? "",
    maxPerPerson: source.maxPerPerson ?? "",
    itemLink: source.itemLink ?? "",
    imageUrl: source.imageUrl ?? "",
    description: source.description ?? "",
    active: source.active !== false,
  };
}
