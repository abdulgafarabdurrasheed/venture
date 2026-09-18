export const SHOP_LABEL_COLORS = [
  { id: "green", label: "Green", hex: "#8C9964" },
  { id: "orange", label: "Orange", hex: "#C99664" },
  { id: "blue", label: "Blue", hex: "#9BC1C9" },
  { id: "red", label: "Red", hex: "#953E4B" },
];

const colorById = new Map(SHOP_LABEL_COLORS.map((color) => [color.id, color]));

export const DEFAULT_SHOP_LABEL_COLOR = "green";

export function normalizeShopLabelColor(value) {
  const id = String(value || DEFAULT_SHOP_LABEL_COLOR).trim().toLowerCase();
  return colorById.has(id) ? id : DEFAULT_SHOP_LABEL_COLOR;
}

export function shopLabelColorHex(value) {
  return colorById.get(normalizeShopLabelColor(value))?.hex ?? colorById.get(DEFAULT_SHOP_LABEL_COLOR).hex;
}
