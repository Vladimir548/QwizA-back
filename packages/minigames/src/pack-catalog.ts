export const BUILTIN_PACK_IDS = ["mix", "cinema", "space"] as const;
export type BuiltinPackId = (typeof BUILTIN_PACK_IDS)[number];
export function isBuiltinPackId(id: string): id is BuiltinPackId {
  return BUILTIN_PACK_IDS.some((builtin) => builtin === id);
}
export const PACK_MODERATION_FILTERS = [
  "pending",
  "approved",
  "rejected",
  "draft",
  "official",
  "all",
] as const;
export type PackModerationFilter = (typeof PACK_MODERATION_FILTERS)[number];
export const PACK_PAGE_SIZE = 20;
export const PACK_SORTS = ["newest", "popular", "rating"] as const;
export type PackCatalogSort = (typeof PACK_SORTS)[number];
export interface PackCatalogEntry<TPack> {
  id: string;
  pack?: TPack;
  playCount: number;
  rating: { packId: string; average: number | null; count: number };
}
export interface PackCatalogPage<TPack> {
  items: PackCatalogEntry<TPack>[];
  total: number;
  page: number;
  pageSize: number;
}
