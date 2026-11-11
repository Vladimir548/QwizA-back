export const ACCOUNT_ROLES = ["user", "media", "admin"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export function canUseBuiltinMedia(user: { role?: string } | null | undefined) {
  return user?.role === "media" || user?.role === "admin";
}
