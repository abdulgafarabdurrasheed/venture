export const STAR_REWARD_CATEGORIES = [
  { value: "creator_gear", label: "Creator gear" },
  { value: "merch", label: "Venture merch" },
  { value: "magazine", label: "Venture magazine" },
  { value: "other", label: "Other star reward" },
];

export function starRewardCategoryLabel(value) {
  return STAR_REWARD_CATEGORIES.find((category) => category.value === value)?.label || "Star reward";
}
