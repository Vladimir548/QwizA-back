import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { ConfigService } from "@nestjs/config";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PrismaService } from "../src/prisma/prisma.service";
import { SessionService } from "../src/auth/session.service";
import { AuthService } from "../src/auth/auth.service";
import { RoomsService } from "../src/rooms/rooms.service";
import { MediaRepository } from "../src/workshop/media.repository";
import { MediaService } from "../src/workshop/media.service";
import { PacksRepository } from "../src/workshop/packs.repository";
import { PacksService } from "../src/workshop/packs.service";
import { PackWorkflowService } from "../src/workshop/pack-workflow.service";
import { PackDto } from "../src/workshop/dto/pack.dto";
import { PackReviewDto } from "../src/workshop/dto/pack-review.dto";
import type { Request } from "express";

const draft = (): PackDto => ({
  title: "Кино на вечер",
  description: "Истории, которые мы помним",
  rounds: ["Первый раунд"],
  topics: [
    {
      title: "Кино",
      ordered: false,
      direction: "forward",
      roundIndex: 0,
      questions: [
        {
          type: "choice",
          answerMode: "buzzer",
          answerTimeSeconds: 30,
          value: 100,
          promptText: "Как зовут ковбоя?",
          choices: ["Вуди", "Базз"],
          correctChoiceIndex: 0,
          answerText: "",
        },
      ],
    },
  ],
});

test("author, cover, validation and versioned admin moderation protect every publication transition", async () => {
  const config = new ConfigService({
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    WEB_ORIGIN: "http://localhost:3000",
    MEDIA_IMAGE_MAX_BYTES: 3145728,
    MEDIA_VIDEO_MAX_BYTES: 20971520,
    MEDIA_AUDIO_MAX_BYTES: 20971520,
  });
  const prisma = new PrismaService(config);
  await prisma.$connect();
  const repository = new PacksRepository(prisma);
  const media = new MediaService(config, new MediaRepository(prisma));
  const packs = new PacksService(repository, media);
  const workflow = new PackWorkflowService(repository, packs);
  const sessions = new SessionService(prisma, config);
  const rooms = new RoomsService(prisma, repository);
  const auth = new AuthService(prisma, rooms, sessions);
  const users: string[] = [],
    ids: string[] = [];
  let coverId: string | undefined;
  let retainedRoomId: string | undefined;
  try {
    const register = async (name: string) => {
      const account = await auth.register({
        password: "PackTestPassword123!",
        nickname: `${name}-${randomUUID().slice(0, 8)}`,
      });
      users.push(account.user.id);
      return account;
    };
    const owner = await register("Автор"),
      other = await register("Другой автор"),
      adminAccount = await register("Модератор");
    assert.equal(adminAccount.user.role, "user");
    await prisma.userAccount.update({
      where: { id: adminAccount.user.id },
      data: { role: "admin" },
    });
    const admin = (await sessions.user(adminAccount.token))!;
    assert.equal(admin.role, "admin");
    const request = {
      headers: { cookie: `qwesto_session=${owner.token}`, origin: "http://localhost:3000" },
    } as Request;
    assert.equal((await sessions.requireUser(request)).id, owner.user.id);
    await assert.rejects(sessions.requireUser({ headers: {} } as Request), /Войди/);
    await assert.rejects(
      sessions.requireUser({
        headers: { ...request.headers, origin: "https://wrong.example" },
      } as Request),
      /источник/,
    );
    const image = await sharp({
      create: { width: 160, height: 90, channels: 3, background: "navy" },
    })
      .png()
      .toBuffer();
    const cover = await media.uploadImage({
      buffer: image,
      mimetype: "image/png",
      size: image.length,
    } as Express.Multer.File);
    coverId = cover.id;
    const input = { ...draft(), cover };
    let pack = await workflow.create(input, owner.user);
    ids.push(pack.id);
    assert.equal(pack.author?.id, owner.user.id);
    assert.equal(pack.isOfficial, false);
    assert.equal((await packs.get(pack.id)).cover?.id, cover.id);
    await assert.rejects(workflow.get(pack.id, other.user), /недоступен/);
    await assert.rejects(workflow.get(pack.id), /недоступен/);
    await assert.rejects(workflow.update(pack.id, input, other.user), /автор/);
    await assert.rejects(workflow.remove(pack.id, other.user), /автор/);
    assert.equal((await workflow.check(pack)).valid, true);
    assert.equal((await packs.check({ ...input, topics: [] })).valid, false);
    assert.equal((await packs.check({ ...input, rounds: [] })).valid, false);
    const invalid = draft();
    invalid.topics[0].questions[0].correctChoiceIndex = null;
    assert.equal((await packs.check(invalid)).valid, false);
    pack = await workflow.publication(pack.id, true, owner.user);
    assert.equal(pack.status, "pending");
    assert.equal(pack.published, false);
    assert.equal(
      (await packs.store()).some((item) => item.id === pack.id),
      false,
    );
    await assert.rejects(async () => workflow.queue(other.user), /администратор/);
    assert.equal(
      (await workflow.queue(admin)).some((item) => item.id === pack.id),
      true,
    );
    await assert.rejects(
      workflow.review(pack.id, other.user, { revision: pack.revision!, decision: "approve" }),
      /администратор/,
    );
    await assert.rejects(
      workflow.review(pack.id, admin, {
        revision: pack.revision!,
        decision: "reject",
        reason: "   ",
      }),
      /причину/,
    );
    pack = await workflow.review(pack.id, admin, {
      revision: pack.revision!,
      decision: "reject",
      reason: "Уточни формулировку вопроса",
    });
    assert.equal(pack.rejectionReason, "Уточни формулировку вопроса");
    assert.equal(pack.status, "rejected");
    pack = await workflow.update(pack.id, input, owner.user);
    assert.equal(pack.rejectionReason, undefined);
    pack = await workflow.publication(pack.id, true, owner.user);
    const stale = pack.revision!;
    pack = await workflow.update(
      pack.id,
      { ...input, description: "Обновлённое описание" },
      owner.user,
    );
    await assert.rejects(
      workflow.review(pack.id, admin, { revision: stale, decision: "approve" }),
      /изменена/,
    );
    assert.equal(pack.status, "pending");
    pack = await workflow.review(pack.id, admin, { revision: pack.revision!, decision: "approve" });
    assert.equal(pack.status, "approved");
    assert.equal(pack.published, true);
    assert.equal((await workflow.get(pack.id)).author?.name, owner.user.displayName);
    assert.equal(
      (await packs.store()).some((item) => item.id === pack.id),
      true,
    );
    await assert.rejects(
      workflow.review(pack.id, admin, { revision: pack.revision!, decision: "approve" }),
      /проверена/,
    );
    const approvedRevision = pack.revision!;
    const persisted = await packs.get(pack.id);
    const unchanged = await workflow.update(
      pack.id,
      {
        ...input,
        title: pack.title + " ",
        description: pack.description,
        topics: persisted.topics,
      },
      owner.user,
    );
    assert.equal(unchanged.revision, approvedRevision);
    assert.equal(unchanged.status, "approved");
    const editedTopics = structuredClone(persisted.topics);
    editedTopics[0].questions[0].promptText += " Ещё подсказка.";
    pack = await workflow.update(
      pack.id,
      { ...input, revision: approvedRevision, topics: editedTopics },
      owner.user,
    );
    assert.equal(pack.status, "pending");
    assert.equal(pack.published, false);
    assert.ok((await packs.get(pack.id)).submittedAt);
    assert.equal(pack.reviewedAt, undefined);
    assert.ok((await workflow.queue(admin)).some((item) => item.id === pack.id));
    assert.ok(!(await packs.store()).some((item) => item.id === pack.id));
    await assert.rejects(
      workflow.update(pack.id, { ...input, revision: approvedRevision }, owner.user),
      /изменился/,
    );
    pack = await workflow.review(pack.id, admin, { revision: pack.revision!, decision: "approve" });
    assert.ok((await workflow.queue(admin, "approved")).some((item) => item.id === pack.id));
    await assert.rejects(async () => workflow.queue(other.user, "all"), /администратор/);
    await assert.rejects(
      workflow.review(pack.id, other.user, {
        revision: pack.revision!,
        decision: "revoke",
        reason: "Ошибка",
      }),
      /администратор/,
    );
    await assert.rejects(
      workflow.review(pack.id, admin, {
        revision: pack.revision!,
        decision: "revoke",
        reason: "  ",
      }),
      /причину/,
    );
    await assert.rejects(
      workflow.review(pack.id, admin, {
        revision: pack.revision! - 1,
        decision: "revoke",
        reason: "Ошибка",
      }),
      /изменена/,
    );
    pack = await workflow.review(pack.id, admin, {
      revision: pack.revision!,
      decision: "revoke",
      reason: "Нужно уточнить ответ",
    });
    assert.equal(pack.status, "rejected");
    assert.equal(pack.published, false);
    assert.equal((await workflow.get(pack.id, owner.user)).rejectionReason, "Нужно уточнить ответ");
    await assert.rejects(workflow.get(pack.id), /недоступен/);
    assert.ok(!(await packs.store()).some((item) => item.id === pack.id));
    pack = await workflow.update(pack.id, input, owner.user);
    assert.equal(pack.published, false);
    assert.equal(pack.status, "draft");
    assert.equal(
      (await packs.store()).some((item) => item.id === pack.id),
      false,
    );
    let official = await workflow.create(draft(), admin);
    ids.push(official.id);
    assert.equal(official.isOfficial, true);
    assert.equal(official.author?.id, admin.id);
    assert.equal(
      (await workflow.list(other.user)).some((item) => ids.includes(item.id)),
      false,
    );
    official = await workflow.publication(official.id, true, admin);
    official = await workflow.review(official.id, admin, {
      revision: official.revision!,
      decision: "approve",
    });
    const room = await rooms.create({
      name: "Игра сохраняется после удаления",
      gameMode: "solo",
      maxPlayers: 2,
      displayName: "Игрок",
      packId: official.id,
    });
    retainedRoomId = room.roomId;
    const topicId = official.topics[0].id;
    const questionId = official.topics[0].questions[0].id;
    await prisma.packRating.create({
      data: { packKey: official.id, packId: official.id, userId: other.user.id, value: 5 },
    });
    await assert.rejects(workflow.remove(official.id, other.user, official.revision), /автор/);
    await assert.rejects(workflow.remove(official.id, admin, official.revision! - 1), /изменился/);
    await workflow.remove(official.id, admin, official.revision);
    assert.equal(await prisma.pack.findUnique({ where: { id: official.id } }), null);
    assert.equal(await prisma.topic.count({ where: { id: topicId } }), 0);
    assert.equal(await prisma.question.count({ where: { id: questionId } }), 0);
    assert.equal(await prisma.packRating.count({ where: { packKey: official.id } }), 0);
    assert.ok(await prisma.gameRoom.findUnique({ where: { id: room.roomId } }));
    assert.equal((await rooms.publicSnapshot(room.roomId)).packTitle, official.title);
  } finally {
    if (retainedRoomId) await prisma.gameRoom.delete({ where: { id: retainedRoomId } });
    await prisma.pack.deleteMany({ where: { id: { in: ids } } });
    await prisma.userAccount.deleteMany({ where: { id: { in: users } } });
    if (coverId) {
      await prisma.mediaAsset.delete({ where: { id: coverId } });
      await unlink(join(process.cwd(), ".local-data", "media", `${coverId}.webp`));
    }
    await prisma.$disconnect();
  }
});
test("transport rejects forged authorship and official labels, and bounds moderator comments", async () => {
  const forged = plainToInstance(PackDto, {
    ...draft(),
    isOfficial: true,
    author: { id: randomUUID(), name: "Admin" },
    status: "approved",
    published: true,
  });
  const errors = await validate(forged, { whitelist: true, forbidNonWhitelisted: true });
  assert.ok(errors.some((error) => error.property === "isOfficial"));
  assert.ok(errors.some((error) => error.property === "author"));
  assert.ok(
    (
      await validate(
        plainToInstance(PackReviewDto, {
          revision: 1,
          decision: "reject",
          reason: "x".repeat(1001),
        }),
      )
    ).length,
  );
});
