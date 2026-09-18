export function displayName(user) {
  if (user?.slug?.trim()) return user.slug.trim();
  if (user?.name?.trim()) return user.name.trim();
  if (user?.email?.includes("@")) return user.email.split("@")[0];
  return "Explorer";
}
