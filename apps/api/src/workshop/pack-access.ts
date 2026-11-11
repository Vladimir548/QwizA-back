import type { WorkshopPack } from "./workshop.model";
export function canEditPack(pack: WorkshopPack, actor?: { id: string; role: string } | null) {
  return Boolean(actor && (actor.role === "admin" || pack.author?.id === actor.id));
}
export function canViewPack(pack: WorkshopPack, actor?: { id: string; role: string } | null) {
  return Boolean(pack.published && pack.status === "approved") || canEditPack(pack, actor);
}
