import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AccountIdentity } from "../auth/session.service";
import type { PackDto } from "./dto/pack.dto";
import { PacksRepository } from "./packs.repository";
import { PacksService } from "./packs.service";
import type { WorkshopPack } from "./workshop.model";
import { canEditPack, canViewPack } from "./pack-access";

@Injectable()
export class PackWorkflowService {
  constructor(
    private readonly repository: PacksRepository,
    private readonly packs: PacksService,
  ) {}
  list(actor: AccountIdentity) {
    return this.repository.list(
      actor.role === "admin"
        ? { OR: [{ authorId: actor.id }, { authorId: null }] }
        : { authorId: actor.id },
    );
  }
  library(actor?: AccountIdentity | null) {
    return this.repository.list({
      OR: [{ published: true, status: "approved" }, ...(actor ? [{ authorId: actor.id }] : [])],
    });
  }
  async get(id: string, actor?: AccountIdentity | null) {
    const pack = await this.packs.get(id);
    if (!canViewPack(pack, actor)) throw new NotFoundException("Пак не опубликован или недоступен");
    return pack;
  }
  private async owned(id: string, actor: AccountIdentity) {
    const pack = await this.packs.get(id);
    if (!canEditPack(pack, actor))
      throw new ForbiddenException("Редактировать пак может только его автор");
    return pack;
  }
  create(input: PackDto, actor: AccountIdentity) {
    return this.packs.create(
      input,
      { id: actor.id, name: actor.displayName },
      actor.role === "admin",
    );
  }
  async update(id: string, input: PackDto, actor: AccountIdentity) {
    await this.owned(id, actor);
    return this.packs.update(id, input);
  }
  async remove(id: string, actor: AccountIdentity) {
    await this.owned(id, actor);
    return this.packs.remove(id);
  }
  async publication(id: string, submit: boolean, actor: AccountIdentity) {
    const pack = await this.owned(id, actor);
    if (submit && pack.status === "pending") throw new ConflictException("Пак уже на проверке");
    if (submit && pack.status === "approved") throw new ConflictException("Пак уже опубликован");
    if (submit && !(await this.check(pack)).valid)
      throw new BadRequestException("Сначала исправь ошибки проверки пака");
    const updated = await this.repository.transition(
      id,
      pack.revision ?? 1,
      pack.status ?? "draft",
      {
        status: submit ? "pending" : "draft",
        published: false,
        submittedAt: submit ? new Date() : null,
        reviewedAt: null,
        reviewedById: null,
        rejectionReason: null,
      },
    );
    if (!updated) throw new ConflictException("Пак изменился. Обнови страницу");
    return this.packs.get(id);
  }
  check(pack: WorkshopPack) {
    return this.packs.check({
      ...pack,
      topics: pack.topics.map((topic) => ({
        ...topic,
        questions: topic.questions.map((q) => ({
          ...q,
          answerMode: q.answerMode ?? "buzzer",
          answerTimeSeconds: q.answerTimeSeconds ?? 30,
        })),
      })),
    });
  }
  private admin(actor: AccountIdentity) {
    if (actor.role !== "admin") throw new ForbiddenException("Раздел доступен администратору");
  }
  queue(actor: AccountIdentity) {
    this.admin(actor);
    return this.repository.list({ status: "pending" });
  }
  async review(
    id: string,
    actor: AccountIdentity,
    input: { revision: number; decision: "approve" | "reject"; reason?: string },
  ) {
    this.admin(actor);
    const pack = await this.packs.get(id);
    const reason = input.reason?.trim();
    if (input.decision === "reject" && !reason)
      throw new BadRequestException("Напиши причину отклонения");
    if (input.decision === "approve" && !(await this.check(pack)).valid)
      throw new BadRequestException("Пак не прошёл проверку содержимого");
    const updated = await this.repository.transition(id, input.revision, "pending", {
      status: input.decision === "approve" ? "approved" : "rejected",
      published: input.decision === "approve",
      reviewedAt: new Date(),
      reviewedById: actor.id,
      rejectionReason: input.decision === "reject" ? reason : null,
    });
    if (!updated)
      throw new ConflictException("Эта версия уже проверена или изменена автором. Обнови очередь");
    return this.packs.get(id);
  }
}
