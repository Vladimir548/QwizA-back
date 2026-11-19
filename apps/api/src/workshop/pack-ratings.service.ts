import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { isUUID } from "class-validator";
import type { AccountIdentity } from "../auth/session.service";
import { PackRatingsRepository } from "./pack-ratings.repository";
import { PacksRepository } from "./packs.repository";
import { isBuiltinPackId } from "@qwiza/minigames";

@Injectable()
export class PackRatingsService {
  constructor(
    private readonly repository: PackRatingsRepository,
    private readonly packs: PacksRepository,
  ) {}

  async list() {
    return this.repository.list(await this.packs.availableBuiltinIds());
  }

  private async target(id: string) {
    const key = id.toLowerCase();
    if (isBuiltinPackId(key)) {
      if (!(await this.packs.isBuiltinAvailable(key))) throw new NotFoundException("Пак не найден");
      return { key, packId: null, authorId: null };
    }
    if (!isUUID(key)) throw new NotFoundException("Пак не найден");
    const pack = await this.repository.publishedPack(key);
    if (!pack) throw new NotFoundException("Оценивать можно только опубликованные паки");
    return { key, packId: key, authorId: pack.authorId };
  }

  async get(id: string, actor?: AccountIdentity | null) {
    const pack = await this.target(id);
    return {
      ...(await this.repository.summary(pack.key, actor?.id)),
      canRate: Boolean(actor && actor.id !== pack.authorId),
      restriction: !actor
        ? ("sign-in" as const)
        : actor.id === pack.authorId
          ? ("own-pack" as const)
          : null,
    };
  }

  async rate(id: string, value: number, actor: AccountIdentity) {
    if (!Number.isInteger(value) || value < 1 || value > 5)
      throw new BadRequestException("Выбери оценку от 1 до 5");
    const pack = await this.target(id);
    if (pack.authorId === actor.id) throw new ForbiddenException("Нельзя оценивать свой пак");
    await this.repository.save(pack.key, pack.packId, actor.id, value);
    return this.get(pack.key, actor);
  }

  async remove(id: string, actor: AccountIdentity) {
    const pack = await this.target(id);
    await this.repository.remove(pack.key, actor.id);
    return this.get(pack.key, actor);
  }
}
