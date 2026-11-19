import { Injectable } from "@nestjs/common";
import { isBuiltinPackId, PACK_PAGE_SIZE, type PackCatalogPage } from "@qwiza/minigames";
import { PacksRepository } from "./packs.repository";
import { PackRatingsRepository } from "./pack-ratings.repository";
import type { PackCatalogQueryDto } from "./dto/pack-catalog.dto";
import type { WorkshopPack } from "./workshop.model";

@Injectable()
export class PackCatalogService {
  constructor(
    private readonly packs: PacksRepository,
    private readonly ratings: PackRatingsRepository,
  ) {}

  async list(query: PackCatalogQueryDto): Promise<PackCatalogPage<WorkshopPack>> {
    const [published, builtinIds, plays] = await Promise.all([
      this.packs.catalogEntries(),
      this.packs.availableBuiltinIds(),
      this.packs.playCounts(),
    ]);
    const ratings = await this.ratings.list(builtinIds);
    const byRating = new Map(ratings.map((entry) => [entry.packId, entry]));
    const byPlays = new Map(plays.map((entry) => [entry.packId ?? "mix", entry._count._all]));
    const entries = [
      ...published,
      ...builtinIds.map((id) => ({ id, isOfficial: true, createdAt: new Date(0) })),
    ]
      .filter((entry) => !query.official || entry.isOfficial)
      .map((entry) => ({
        ...entry,
        playCount: byPlays.get(entry.id) ?? 0,
        rating: byRating.get(entry.id) ?? { packId: entry.id, average: null, count: 0 },
      }));
    entries.sort((a, b) => {
      const newest = b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
      const rating =
        (b.rating.average ?? -1) - (a.rating.average ?? -1) || b.rating.count - a.rating.count;
      return query.sort === "popular"
        ? b.playCount - a.playCount || rating || newest
        : query.sort === "rating"
          ? rating || newest
          : newest;
    });
    const total = entries.length;
    const page = Math.min(query.page ?? 1, Math.max(1, Math.ceil(total / PACK_PAGE_SIZE)));
    const selected = entries.slice((page - 1) * PACK_PAGE_SIZE, page * PACK_PAGE_SIZE);
    const fullPacks = await this.packs.list({
      id: {
        in: selected.filter((entry) => !isBuiltinPackId(entry.id)).map((entry) => entry.id),
      },
      published: true,
      status: "approved",
    });
    const byId = new Map(fullPacks.map((pack) => [pack.id, pack]));
    return {
      items: selected
        .filter((entry) => byId.has(entry.id) || isBuiltinPackId(entry.id))
        .map(({ id, rating, playCount }) => ({
          id,
          rating,
          playCount,
          ...(byId.has(id) ? { pack: byId.get(id) } : {}),
        })),
      total,
      page,
      pageSize: PACK_PAGE_SIZE,
    };
  }
}
