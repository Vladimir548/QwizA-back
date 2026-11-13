import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { AuthService } from "../src/auth/auth.service";
import { SessionService } from "../src/auth/session.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { RoomsService } from "../src/rooms/rooms.service";
import { RoomsController } from "../src/rooms/rooms.controller";
import { PacksRepository } from "../src/workshop/packs.repository";
import { requireTeamModeAccess } from "../src/rooms/team-mode-access";

test("team preview requires the current account admin role for create, join and rejoin", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  await prisma.$connect();
  const packs = new PacksRepository(prisma);
  const rooms = new RoomsService(prisma, packs);
  const sessions = new SessionService(
    prisma,
    new ConfigService({ WEB_ORIGIN: "http://127.0.0.1:3000" }),
  );
  const auth = new AuthService(prisma, rooms, sessions);
  const controller = new RoomsController(rooms, sessions, packs);
  const accountIds: string[] = [],
    roomIds: string[] = [];
  const request = (token?: string) =>
    ({ headers: { cookie: token ? `qwesto_session=${token}` : undefined } }) as Request;
  try {
    const regular = await auth.register({
      password: randomUUID(),
      nickname: `Игрок-${randomUUID().slice(0, 8)}`,
    });
    accountIds.push(regular.user.id);
    const developer = await auth.register({
      password: randomUUID(),
      nickname: `Разработчик-${randomUUID().slice(0, 8)}`,
    });
    accountIds.push(developer.user.id);
    await prisma.userAccount.update({ where: { id: developer.user.id }, data: { role: "admin" } });
    const input = {
      name: "Предпросмотр команд",
      gameMode: "team" as const,
      maxPlayers: 4,
      displayName: "Разработчик",
    };
    for (const denied of [request(), request(regular.token), request("a".repeat(44))])
      await assert.rejects(controller.create(input, denied), /Командная игра в разработке/);
    const created = await controller.create(input, request(developer.token));
    roomIds.push(created.roomId);
    for (const denied of [request(), request(regular.token)])
      await assert.rejects(
        controller.join(created.roomId, { displayName: "Игрок" }, denied),
        /Командная игра в разработке/,
      );
    await controller.join(
      created.roomId,
      { displayName: "Разработчик 2" },
      request(developer.token),
    );
    await auth.claimRoom(developer.token, created.roomId, created.token);
    assert.equal((await auth.rejoinRoom(developer.token, created.roomId)).roomId, created.roomId);
    // A pre-existing team membership must not grant a regular account new credentials.
    const legacySeat = await rooms.join(created.roomId, { displayName: "Старое место" });
    await auth.claimRoom(regular.token, created.roomId, legacySeat.token);
    await assert.rejects(
      auth.rejoinRoom(regular.token, created.roomId),
      /Командная игра в разработке/,
    );
    await prisma.userAccount.update({ where: { id: developer.user.id }, data: { role: "user" } });
    await assert.rejects(
      controller.create(input, request(developer.token)),
      /Командная игра в разработке/,
    );
    await assert.rejects(
      controller.join(created.roomId, { displayName: "Нет доступа" }, request(developer.token)),
      /Командная игра в разработке/,
    );
    await assert.rejects(
      auth.rejoinRoom(developer.token, created.roomId),
      /Командная игра в разработке/,
    );
    const solo = await controller.create({ ...input, gameMode: "solo", maxPlayers: 2 }, request());
    roomIds.push(solo.roomId);
    assert.equal(
      (await controller.join(solo.roomId, { displayName: "Гость" }, request())).roomId,
      solo.roomId,
    );
    assert.doesNotThrow(() => requireTeamModeAccess("solo", null));
  } finally {
    await prisma.gameRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  }
});
