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

test("guests and ordinary accounts can create, join and start team games", async () => {
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
  const roomIds: string[] = [];
  let accountId: string | undefined;
  const request = (token?: string) =>
    ({ headers: { cookie: token ? `qwesto_session=${token}` : undefined } }) as Request;
  try {
    const regular = await auth.register({
      password: randomUUID(),
      nickname: `Игрок-${randomUUID().slice(0, 8)}`,
    });
    accountId = regular.user.id;
    assert.equal(regular.user.role, "user");
    const input = {
      name: "Командная игра",
      gameMode: "team" as const,
      maxPlayers: 4,
      displayName: "Создатель",
    };
    const created = await controller.create(input, request());
    roomIds.push(created.roomId);
    assert.equal(created.snapshot.gameMode, "team");
    await assert.rejects(
      controller.create({ ...input, teamCount: 4, maxPlayers: 12 }, request()),
      /Для четырёх команд нужно по два игрока/,
    );
    for (const [teamCount, maxPlayers] of [
      [4, 8],
      [3, 9],
    ]) {
      const teamRoom = await controller.create(
        { ...input, teamCount, maxPlayers, hostEnabled: true },
        request(regular.token),
      );
      roomIds.push(teamRoom.roomId);
      assert.equal(teamRoom.snapshot.teamCount, teamCount);
      assert.equal(teamRoom.snapshot.maxPlayers, maxPlayers);
    }
    const joined = await controller.join(created.roomId, {
      displayName: "Игрок с аккаунтом",
      teamNumber: 2,
    });
    await auth.claimRoom(regular.token, created.roomId, joined.token);
    const recovered = await auth.rejoinRoom(regular.token, created.roomId);
    assert.equal(recovered.participantId, joined.participantId);
    assert.notEqual(recovered.token, joined.token);
    const player = await rooms.authenticate(created.roomId, recovered.token);
    assert.equal(player.teamId, "team-2");

    await controller.join(created.roomId, { displayName: "Гость 1", teamNumber: 1 });
    await assert.rejects(
      controller.join(created.roomId, { displayName: "Нет места", teamNumber: 1 }),
      /нет свободных мест/,
    );
    await controller.join(created.roomId, { displayName: "Гость 2", teamNumber: 2 });
    const start = { id: randomUUID(), type: "start" as const };
    assert.equal((await rooms.command(created.roomId, joined.participantId, start)).ok, false);
    assert.equal((await rooms.command(created.roomId, created.participantId, start)).ok, true);
    const started = await controller.preview(created.roomId);
    assert.ok(started.phase === "loading" || started.phase === "presentation");
  } finally {
    await prisma.gameRoom.deleteMany({ where: { id: { in: roomIds } } });
    if (accountId) await prisma.userAccount.delete({ where: { id: accountId } });
    await prisma.$disconnect();
  }
});
