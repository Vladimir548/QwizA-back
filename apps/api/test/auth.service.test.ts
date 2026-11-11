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
      email: `seat-${randomUUID()}@example.test`,
      password: "LongTestPassword123!",
      displayName: "Тест",
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
