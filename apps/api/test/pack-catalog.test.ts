import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { ValidationPipe } from "@nestjs/common";
import { BUILTIN_PACK_IDS, PACK_PAGE_SIZE } from "@qwiza/minigames";
import { PrismaService } from "../src/prisma/prisma.service";
import { PacksRepository } from "../src/workshop/packs.repository";
import { PackRatingsRepository } from "../src/workshop/pack-ratings.repository";
import { PackCatalogService } from "../src/workshop/pack-catalog.service";
import { PackRatingsService } from "../src/workshop/pack-ratings.service";
import { PackWorkflowService } from "../src/workshop/pack-workflow.service";
import { PacksService } from "../src/workshop/packs.service";
import { MediaService } from "../src/workshop/media.service";
import { MediaRepository } from "../src/workshop/media.repository";
import { RoomsService } from "../src/rooms/rooms.service";
import {
  PackCatalogQueryDto,
  PackModerationQueryDto,
  PackDeleteQueryDto,
} from "../src/workshop/dto/pack-catalog.dto";

test("catalog query validates fixed-page filtering and moderation parameters", async () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const query = (value: unknown) =>
    pipe.transform(value, { type: "query", metatype: PackCatalogQueryDto });
  assert.equal((await query({ page: "2", sort: "popular", official: "false" })).official, false);
  assert.equal((await query({ official: "true" })).official, true);
  for (const value of [
    { page: "0" },
    { page: "1.5" },
    { page: "100001" },
    { sort: "fake" },
    { official: "yes" },
    { pageSize: "200" },
  ])
    await assert.rejects(query(value));
  await assert.rejects(
    pipe.transform({ status: "secret" }, { type: "query", metatype: PackModerationQueryDto }),
  );
  assert.equal(
    (
      await pipe.transform(
        { status: "official" },
        { type: "query", metatype: PackModerationQueryDto },
      )
    ).status,
    "official",
  );
  await assert.rejects(
    pipe.transform({ revision: "-1" }, { type: "query", metatype: PackDeleteQueryDto }),
  );
});

test("only administrators can hide a built-in pack and restore its public availability", async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
  const config = new ConfigService({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const prisma = new PrismaService(config);
  await prisma.$connect();
  try {
    await prisma.$transaction(async (transaction) => {
      const db = transaction as unknown as PrismaService;
      const packs = new PacksRepository(db);
      const ratings = new PackRatingsRepository(db);
      const packRatings = new PackRatingsService(ratings, packs);
      const workflow = new PackWorkflowService(
        packs,
        new PacksService(packs, new MediaService(config, new MediaRepository(db))),
      );
      const catalog = new PackCatalogService(packs, ratings);
      const rooms = new RoomsService(db, packs);
      const admin = { id: randomUUID(), email: null, displayName: "Администратор", role: "admin" };
      const user = { ...admin, role: "user" };
      const before = await catalog.list({ official: true });
      assert.ok((await workflow.availableBuiltinIds()).includes("mix"));
      await assert.rejects(workflow.setBuiltinPublication("mix", false, user), /администратору/);
      await assert.rejects(workflow.setBuiltinPublication("unknown", false, admin), /не найден/);

      await workflow.setBuiltinPublication("mix", false, admin);
      await workflow.setBuiltinPublication("mix", false, admin);
      assert.ok(!(await workflow.availableBuiltinIds()).includes("mix"));
      const after = await catalog.list({ official: true });
      assert.equal(after.total, before.total - 1);
      assert.ok(after.items.every((entry) => entry.id !== "mix"));
      assert.ok((await packRatings.list()).every((entry) => entry.packId !== "mix"));
      await assert.rejects(packRatings.get("mix"), /Пак не найден/);
      await assert.rejects(
        rooms.create({
          name: "Тестовая игра",
          displayName: "Игрок",
          gameMode: "solo",
          maxPlayers: 2,
        }),
        /Стартовый пак недоступен/,
      );

      await workflow.setBuiltinPublication("mix", true, admin);
      assert.ok((await workflow.availableBuiltinIds()).includes("mix"));
      assert.equal((await catalog.list({ official: true })).total, before.total);
      assert.equal((await packRatings.get("mix")).packId, "mix");
    });
  } finally {
    await prisma.$disconnect();
  }
});

test("catalog paginates one combined official/community list and sorts by genuine games, rating and creation date", async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
  const prisma = new PrismaService(
    new ConfigService({ DATABASE_URL: process.env.TEST_DATABASE_URL }),
  );
  await prisma.$connect();
  const service = new PackCatalogService(
    new PacksRepository(prisma),
    new PackRatingsRepository(prisma),
  );
  const ids = Array.from({ length: 26 }, () => randomUUID());
  const users = [randomUUID(), randomUUID()];
  const roomIds = Array.from({ length: 8 }, () => randomUUID());
  try {
    await prisma.userAccount.createMany({
      data: users.map((id) => ({
        id,
        nicknameKey: `catalog-${id.slice(0, 8)}`,
        displayName: `catalog-${id.slice(0, 8)}`,
        passwordHash: "test-fixture-no-login",
      })),
    });
    await prisma.pack.createMany({
      data: ids.map((id, index) => ({
        id,
        title: `Каталог ${index}`,
        description: "Тестовый пак",
        published: index < 25,
        status: index < 25 ? "approved" : "pending",
        isOfficial: index % 2 === 0,
        createdAt: new Date(Date.UTC(2090, 0, 30 - index)),
      })),
    });
    await prisma.packRating.createMany({
      data: [
        { packKey: ids[3], packId: ids[3], userId: users[0], value: 5 },
        { packKey: ids[3], packId: ids[3], userId: users[1], value: 5 },
        { packKey: ids[1], packId: ids[1], userId: users[0], value: 5 },
        { packKey: ids[2], packId: ids[2], userId: users[0], value: 4 },
      ],
    });
    await prisma.gameRoom.createMany({
      data: roomIds.map((id, index) => ({
        id,
        code: id.slice(0, 8).toUpperCase(),
        creatorId: randomUUID(),
        name: "Тест популярности",
        gameMode: "solo",
        maxPlayers: 2,
        packId: index === 3 ? ids[1] : ids[0],
        state: { phase: index >= 4 ? "lobby" : "board" },
        pack: {},
      })),
    });
    const first = await service.list({ sort: "newest" });
    const second = await service.list({ sort: "newest", page: 2 });
    assert.equal(first.pageSize, PACK_PAGE_SIZE);
    assert.equal(first.items.length, 20);
    assert.ok(first.total >= 25 + BUILTIN_PACK_IDS.length);
    assert.deepEqual(
      first.items.map((entry) => entry.id),
      ids.slice(0, 20),
    );
    assert.deepEqual(
      second.items.slice(0, 5).map((entry) => entry.id),
      ids.slice(20, 25),
    );
    assert.ok(!second.items.some((entry) => first.items.some((item) => item.id === entry.id)));
    assert.ok(![...first.items, ...second.items].some((entry) => entry.id === ids[25]));
    const popular = await service.list({ sort: "popular" });
    assert.equal(popular.items.find((entry) => entry.id === ids[0])?.playCount, 3);
    assert.ok(
      popular.items.findIndex((entry) => entry.id === ids[0]) <
        popular.items.findIndex((entry) => entry.id === ids[1]),
    );
    const rated = await service.list({ sort: "rating" });
    assert.equal(rated.items[0].id, ids[3]);
    assert.ok(
      rated.items.findIndex((entry) => entry.id === ids[1]) <
        rated.items.findIndex((entry) => entry.id === ids[2]),
    );
    const official = await service.list({ official: true });
    assert.ok(
      official.items.every((entry) =>
        entry.pack ? entry.pack.isOfficial : BUILTIN_PACK_IDS.some((id) => id === entry.id),
      ),
    );
    const last = await service.list({ page: 100000 });
    assert.equal(last.page, Math.ceil(last.total / PACK_PAGE_SIZE));
    assert.ok(last.items.length <= PACK_PAGE_SIZE);
  } finally {
    await prisma.gameRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.pack.deleteMany({ where: { id: { in: ids } } });
    await prisma.userAccount.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
});
