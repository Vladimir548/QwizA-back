import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { ValidationPipe } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../src/prisma/prisma.service";
import { SessionService } from "../src/auth/session.service";
import { AuthService } from "../src/auth/auth.service";
import { RoomsService } from "../src/rooms/rooms.service";
import { PacksRepository } from "../src/workshop/packs.repository";
import { PackRatingsRepository } from "../src/workshop/pack-ratings.repository";
import { PackRatingsService } from "../src/workshop/pack-ratings.service";
import { PackRatingsController } from "../src/workshop/pack-ratings.controller";
import { PackRatingDto } from "../src/workshop/dto/pack-rating.dto";

test("ratings accept only integer stars and reject spoofed identity fields", async () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  for (const value of [0, 6, -1, 2.5, "5", null])
    await assert.rejects(pipe.transform({ value }, { type: "body", metatype: PackRatingDto }));
  await assert.rejects(
    pipe.transform({ value: 5, userId: randomUUID() }, { type: "body", metatype: PackRatingDto }),
  );
  for (const value of [1, 2, 3, 4, 5])
    assert.equal(
      (await pipe.transform({ value }, { type: "body", metatype: PackRatingDto })).value,
      value,
    );
});

test("pack ratings persist one vote per account, enforce publication and ownership, and aggregate all public packs", async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
  const config = new ConfigService({
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    WEB_ORIGIN: "http://localhost:3000",
  });
  const prisma = new PrismaService(config);
  await prisma.$connect();
  const sessions = new SessionService(prisma, config);
  const auth = new AuthService(
    prisma,
    new RoomsService(prisma, new PacksRepository(prisma)),
    sessions,
  );
  const service = new PackRatingsService(new PackRatingsRepository(prisma));
  const controller = new PackRatingsController(service, sessions);
  const users: string[] = [],
    packs: string[] = [];
  const request = (token?: string, origin = "http://localhost:3000") =>
    ({ headers: { origin, ...(token ? { cookie: `qwesto_session=${token}` } : {}) } }) as Request;
  try {
    const register = async (displayName: string) => {
      const account = await auth.register({
        email: `rating-${randomUUID()}@example.test`,
        displayName,
        password: "RatingTestPassword123!",
      });
      users.push(account.user.id);
      return account;
    };
    const author = await register("Автор"),
      first = await register("Первый"),
      second = await register("Второй");
    const createPack = async (published: boolean) => {
      const pack = await prisma.pack.create({
        data: {
          id: randomUUID(),
          title: "Проверка рейтинга",
          description: "Одноразовый тестовый пак",
          authorId: author.user.id,
          published,
          status: published ? "approved" : "draft",
        },
      });
      packs.push(pack.id);
      return pack;
    };
    const pack = await createPack(true),
      draft = await createPack(false);
    const empty = await controller.get(pack.id, request());
    assert.equal(empty.average, null);
    assert.equal(empty.count, 0);
    assert.equal(empty.canRate, false);
    assert.equal(empty.restriction, "sign-in");
    await assert.rejects(controller.rate(pack.id, { value: 5 }, request()), /Войди/);
    await assert.rejects(
      controller.rate(pack.id, { value: 5 }, request(first.token, "https://wrong.example")),
      /источник/,
    );
    await assert.rejects(controller.rate(pack.id, { value: 5 }, request(author.token)), /свой пак/);
    await assert.rejects(
      controller.rate(draft.id, { value: 5 }, request(first.token)),
      /опубликованные/,
    );
    await assert.rejects(controller.get(randomUUID(), request()), /опубликованные/);
    await assert.rejects(controller.get("unknown-pack", request()), /не найден/);
    assert.equal((await controller.get(pack.id, request(author.token))).restriction, "own-pack");

    let result = await controller.rate(pack.id, { value: 5 }, request(first.token));
    assert.equal(result.count, 1);
    assert.equal(result.average, 5);
    assert.equal(result.myRating, 5);
    result = await controller.rate(pack.id, { value: 3 }, request(second.token));
    assert.equal(result.average, 4);
    result = await controller.rate(pack.id, { value: 1 }, request(first.token));
    assert.equal(result.count, 2);
    assert.equal(result.average, 2);
    assert.equal(result.myRating, 1);
    await Promise.all([
      controller.rate(pack.id, { value: 2 }, request(first.token)),
      controller.rate(pack.id, { value: 4 }, request(first.token)),
    ]);
    assert.equal((await controller.get(pack.id, request())).count, 2);
    await controller.rate(pack.id, { value: 1 }, request(first.token));
    const reloaded = new PackRatingsService(new PackRatingsRepository(prisma));
    assert.equal((await reloaded.get(pack.id, first.user)).myRating, 1);
    assert.equal((await controller.get(pack.id, request())).myRating, null);
    const list = await controller.list();
    assert.equal(list.find((item) => item.packId === pack.id)?.average, 2);
    assert.ok(!list.some((item) => item.packId === draft.id));
    for (const key of ["mix", "cinema", "space"])
      assert.ok(list.some((item) => item.packId === key));
    assert.deepEqual(Object.keys(list.find((item) => item.packId === pack.id)!).sort(), [
      "average",
      "count",
      "packId",
    ]);

    await prisma.pack.update({
      where: { id: pack.id },
      data: { published: false, status: "pending" },
    });
    await assert.rejects(
      controller.rate(pack.id, { value: 5 }, request(first.token)),
      /опубликованные/,
    );
    assert.ok(!(await controller.list()).some((item) => item.packId === pack.id));
    await prisma.pack.update({
      where: { id: pack.id },
      data: { published: true, status: "approved" },
    });
    result = await controller.remove(pack.id, request(second.token));
    assert.equal(result.count, 1);
    assert.equal(result.myRating, null);
    assert.equal(result.average, 1);
    assert.equal((await controller.remove(pack.id, request(second.token))).count, 1);
    result = await controller.remove(pack.id, request(first.token));
    assert.equal(result.count, 0);
    assert.equal(result.average, null);

    const builtinBefore = await controller.get("space", request());
    const builtin = await controller.rate("space", { value: 4 }, request(first.token));
    assert.equal(builtin.myRating, 4);
    assert.equal(builtin.count, builtinBefore.count + 1);
    assert.equal(
      (await controller.remove("space", request(first.token))).count,
      builtinBefore.count,
    );
    await assert.rejects(
      prisma.packRating.create({
        data: { packKey: pack.id, packId: pack.id, userId: first.user.id, value: 0 },
      }),
    );
    await controller.rate(pack.id, { value: 3 }, request(first.token));
    await prisma.pack.delete({ where: { id: pack.id } });
    assert.equal(await prisma.packRating.count({ where: { packKey: pack.id } }), 0);
  } finally {
    await prisma.pack.deleteMany({ where: { id: { in: packs } } });
    await prisma.userAccount.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
});
