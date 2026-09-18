export const SHOP_LABEL_COLORS = [
  { id: "green", hex: "#8C9964" },
  { id: "orange", hex: "#C99664" },
  { id: "blue", hex: "#9BC1C9" },
  { id: "red", hex: "#953E4B" },
];

export const DEFAULT_SHOP_LABEL_COLOR = "green";

const colorById = new Map(SHOP_LABEL_COLORS.map((color) => [color.id, color]));

export function normalizeShopLabelColor(value) {
  const id = String(value || DEFAULT_SHOP_LABEL_COLOR).trim().toLowerCase();
  return colorById.has(id) ? id : DEFAULT_SHOP_LABEL_COLOR;
}

export function shopLabelColorHex(value) {
  return colorById.get(normalizeShopLabelColor(value))?.hex ?? colorById.get(DEFAULT_SHOP_LABEL_COLOR).hex;
}
