import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PackRatingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  publishedPack(id: string) {
    return this.prisma.pack.findFirst({
      where: { id, published: true, status: "approved" },
      select: { id: true, authorId: true },
    });
  }

  async list(builtinIds: string[]) {
    const packs = await this.prisma.pack.findMany({
      where: { published: true, status: "approved" },
      select: { id: true },
    });
    const keys = [...builtinIds, ...packs.map((pack) => pack.id)];
    const groups = await this.prisma.packRating.groupBy({
      by: ["packKey"],
      where: { packKey: { in: keys } },
      _avg: { value: true },
      _count: { _all: true },
    });
    const byKey = new Map(groups.map((group) => [group.packKey, group]));
    return keys.map((packId) => ({
      packId,
      average: byKey.get(packId)?._avg.value ?? null,
      count: byKey.get(packId)?._count._all ?? 0,
    }));
  }

  async summary(packKey: string, userId?: string) {
    const [aggregate, own] = await Promise.all([
      this.prisma.packRating.aggregate({
        where: { packKey },
        _avg: { value: true },
        _count: { _all: true },
      }),
      userId
        ? this.prisma.packRating.findUnique({
            where: { packKey_userId: { packKey, userId } },
            select: { value: true },
          })
        : Promise.resolve(null),
    ]);
    return {
      packId: packKey,
      average: aggregate._avg.value,
      count: aggregate._count._all,
      myRating: own?.value ?? null,
    };
  }

  save(packKey: string, packId: string | null, userId: string, value: number) {
    return this.prisma.packRating.upsert({
      where: { packKey_userId: { packKey, userId } },
      create: { packKey, packId, userId, value },
      update: { value },
    });
  }

  remove(packKey: string, userId: string) {
    return this.prisma.packRating.deleteMany({ where: { packKey, userId } });
  }
}
