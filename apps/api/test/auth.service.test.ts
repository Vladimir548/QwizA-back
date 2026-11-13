import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "../src/auth/auth.service";
import { SessionService } from "../src/auth/session.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { RoomsService } from "../src/rooms/rooms.service";
import { PacksRepository } from "../src/workshop/packs.repository";
import { ValidationPipe } from "@nestjs/common";
import { RegisterDto, LoginDto } from "../src/auth/auth.dto";

test("registration accepts only nickname and password and validates nickname boundaries", async () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const password = "LongTestPassword123!";
  const transform = (value: unknown) =>
    pipe.transform(value, { type: "body", metatype: RegisterDto });
  assert.equal((await transform({ nickname: "  Игрок  ", password })).nickname, "Игрок");
  for (const nickname of ["", "  ", "ab", "a".repeat(41), null, 123])
    await assert.rejects(transform({ nickname, password }));
  await assert.rejects(transform({ nickname: "Игрок", password: "short" }));
  await assert.rejects(transform({ nickname: "Игрок", password, role: "admin" }));
  await assert.rejects(transform({ email: "old@example.test", password }));
  assert.equal(
    (await pipe.transform({ nickname: "Я", password }, { type: "body", metatype: LoginDto }))
      .nickname,
    "Я",
  );
});

test("unique nicknames support case-insensitive login, race-safe registration and legacy sessions", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  await prisma.$connect();
  const auth = new AuthService(
    prisma,
    new RoomsService(prisma, new PacksRepository(prisma)),
    new SessionService(prisma, new ConfigService({ WEB_ORIGIN: "http://localhost:3000" })),
  );
  const nickname = `Игрок-${randomUUID().slice(0, 8)}`;
  const password = randomUUID();
  const ids: string[] = [];
  try {
    const account = await auth.register({ nickname: ` ${nickname} `, password });
    ids.push(account.user.id);
    assert.equal(account.user.displayName, nickname);
    assert.equal(account.user.email, null);
    assert.equal(account.user.role, "user");
    assert.equal(Object.hasOwn(account.user, "passwordHash"), false);
    assert.equal(Object.hasOwn(account.user, "nicknameKey"), false);
    const loggedIn = await auth.login({ nickname: ` ${nickname.toUpperCase()} `, password });
    assert.equal(loggedIn.user.id, account.user.id);
    assert.equal((await auth.user(account.token))?.id, account.user.id);
    await assert.rejects(
      auth.login({ nickname, password: "WrongPassword" }),
      /Неверный ник или пароль/,
    );
    await assert.rejects(
      auth.login({ nickname: "missing-" + nickname, password }),
      /Неверный ник или пароль/,
    );
    await assert.rejects(
      auth.register({ nickname: nickname.toUpperCase(), password }),
      /ник уже занят/,
    );
    await assert.rejects(auth.register({ nickname: " \n ", password }), /пустым/);
    await assert.rejects(auth.register({ nickname: "a\nb", password }), /управляющих/);
    const outcomes = await Promise.allSettled(
      [nickname + "-race", nickname.toUpperCase() + "-RACE"].map(async (nick) => {
        const created = await auth.register({ nickname: nick, password });
        ids.push(created.user.id);
        return created;
      }),
    );
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && /ник уже занят/.test(String(rejected.reason)));
    const email = `${randomUUID().slice(0, 8)}@example.test`;
    await prisma.userAccount.update({ where: { id: account.user.id }, data: { email } });
    await assert.rejects(
      auth.register({ nickname: email.toUpperCase(), password }),
      /ник уже занят/,
    );
    assert.equal(
      (await auth.login({ nickname: email.toUpperCase(), password })).user.id,
      account.user.id,
    );
    assert.equal((await auth.user(account.token))?.id, account.user.id);
    await auth.logout(loggedIn.token);
    assert.equal(await auth.user(loggedIn.token), null);
  } finally {
    await prisma.userAccount.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});

test("one account cannot claim two seats in the same room; rejoin recovers its own seat", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  await prisma.$connect();
  const rooms = new RoomsService(prisma, new PacksRepository(prisma));
  const auth = new AuthService(
    prisma,
    rooms,
    new SessionService(prisma, new ConfigService({ WEB_ORIGIN: "http://localhost:3000" })),
  );
  let roomId: string | undefined;
  let userId: string | undefined;
  try {
    const account = await auth.register({
      password: "LongTestPassword123!",
      nickname: `Тест-${randomUUID().slice(0, 8)}`,
    });
    userId = account.user.id;
    const first = await rooms.create({
      name: "Тестовая комната",
      gameMode: "solo",
      maxPlayers: 2,
      displayName: "Первый",
      requestedRole: "player",
    });
    roomId = first.roomId;
    const second = await rooms.join(roomId, { displayName: "Второй" });
    await auth.claimRoom(account.token, roomId, first.token);
    await assert.rejects(auth.claimRoom(account.token, roomId, second.token), /уже есть место/);
    const recovered = await auth.rejoinRoom(account.token, roomId);
    assert.equal(recovered.participantId, first.participantId);
    assert.notEqual(recovered.token, first.token);
  } finally {
    if (roomId) await prisma.gameRoom.delete({ where: { id: roomId } });
    if (userId) await prisma.userAccount.delete({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
