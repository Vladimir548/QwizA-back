import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { createFinal, createQuizStatistics, type FinalTopic } from "@qwiza/minigames";
import { Prisma } from "../src/generated/prisma/client";
import { AuthService } from "../src/auth/auth.service";
import { SessionService } from "../src/auth/session.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { RoomsService } from "../src/rooms/rooms.service";
import type { PrivateRoomState, RoomPack } from "../src/rooms/rooms.types";
import { PacksRepository } from "../src/workshop/packs.repository";

test("account history returns only owned rooms with genuine solo, team and host results after completion", async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL required");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: url }));
  await prisma.$connect();
  const rooms = new RoomsService(prisma, new PacksRepository(prisma));
  const auth = new AuthService(
    prisma,
    rooms,
    new SessionService(prisma, new ConfigService({ WEB_ORIGIN: "http://localhost:3000" })),
  );
  const roomIds: string[] = [];
  let userId: string | undefined;
  try {
    const account = await auth.register({
      email: `history-${randomUUID()}@example.test`,
      password: randomUUID(),
      displayName: "Игрок",
    });
    userId = account.user.id;
    await assert.rejects(auth.roomsForUser(), /Войди в аккаунт/);
    const create = async (
      gameMode: "solo" | "team" = "solo",
      role: "player" | "host" = "player",
      claim = true,
    ) => {
      const session = await rooms.create({
        name: "История",
        gameMode,
        maxPlayers: 4,
        hostEnabled: true,
        requestedRole: role,
        displayName: "Я",
      });
      roomIds.push(session.roomId);
      if (claim) await auth.claimRoom(account.token, session.roomId, session.token);
      return session;
    };
    const finish = async (
      roomId: string,
      modify?: (state: PrivateRoomState, pack: RoomPack) => void,
    ) => {
      const row = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
      const pack = row.pack as unknown as RoomPack;
      const state = row.state as unknown as PrivateRoomState;
      state.phase = "board";
      state.played = pack.topics
        .filter((t) => !t.isFinal)
        .flatMap((t) => t.questions.map((q) => q.id));
      modify?.(state, pack);
      await prisma.gameRoom.update({
        where: { id: roomId },
        data: {
          state: state as unknown as Prisma.InputJsonValue,
          pack: pack as unknown as Prisma.InputJsonValue,
        },
      });
      return pack;
    };
    const solo = await create();
    const rival = await rooms.join(solo.roomId, { displayName: "Соперник" });
    await prisma.gameParticipant.update({
      where: { id: solo.participantId },
      data: { score: -50 },
    });
    await prisma.gameParticipant.update({
      where: { id: rival.participantId },
      data: { score: 100 },
    });
    const pack = await finish(solo.roomId);
    const host = await create("solo", "host");
    await rooms.join(host.roomId, { displayName: "Гость" });
    await finish(host.roomId);
    const team = await create("team");
    const ally = await rooms.join(team.roomId, { displayName: "Союзник", teamNumber: 1 });
    const opponent = await rooms.join(team.roomId, {
      displayName: "Другая команда",
      teamNumber: 2,
    });
    for (const [id, score] of [
      [team.participantId, 200],
      [ally.participantId, 300],
      [opponent.participantId, 500],
    ] as const)
      await prisma.gameParticipant.update({ where: { id }, data: { score } });
    await finish(team.roomId, (state) => {
      state.teamNames = { "team-1": "Космос" };
    });
    const active = await create();
    await prisma.gameParticipant.update({
      where: { id: active.participantId },
      data: { score: 9999 },
    });
    const foreign = await create("solo", "player", false);
    const list = await auth.roomsForUser(account.token);
    assert.equal(list.length, 4);
    assert.ok(!list.some((room) => room.roomId === foreign.roomId));
    assert.deepEqual(
      list.map((room) => room.updatedAt),
      [...list.map((room) => room.updatedAt)].sort().reverse(),
    );
    const soloResult = list.find((room) => room.roomId === solo.roomId)!;
    assert.equal(soloResult.packTitle, pack.title);
    assert.equal(soloResult.place, 2);
    assert.equal(soloResult.score, -50);
    assert.equal(soloResult.completed, true);
    const hostResult = list.find((room) => room.roomId === host.roomId)!;
    assert.equal(hostResult.role, "host");
    assert.equal(hostResult.place, null);
    assert.equal(hostResult.score, null);
    assert.equal(hostResult.playerCount, 1);
    const teamResult = list.find((room) => room.roomId === team.roomId)!;
    assert.equal(teamResult.place, 1);
    assert.equal(teamResult.score, 500);
    assert.equal(teamResult.teamName, "Космос");
    assert.equal(teamResult.competitorCount, 2);
    const activeResult = list.find((room) => room.roomId === active.roomId)!;
    assert.equal(activeResult.status, "lobby");
    assert.equal(activeResult.completed, false);
    assert.equal(activeResult.place, null);
    assert.equal(activeResult.score, null);
    // Achievement placement uses the same rules as the podium, rather than score order.
    await finish(solo.roomId, (state) => {
      state.victory = { mode: "achievements", criteria: ["correct"] };
      state.statistics = createQuizStatistics([
        { id: solo.participantId, score: -50 },
        { id: rival.participantId, score: 100 },
      ]);
      state.statistics.byId[solo.participantId].correct = 5;
    });
    assert.equal(
      (await auth.roomsForUser(account.token)).find((room) => room.roomId === solo.roomId)?.place,
      1,
    );
    const finalTopic: FinalTopic = {
      id: "f",
      title: "Финал",
      question: { id: "qf", type: "text", prompt: "?", options: [], answer: "Да" },
    };
    await finish(solo.roomId, (state, pack) => {
      pack.topics.push({
        id: finalTopic.id,
        title: finalTopic.title,
        isFinal: true,
        questions: [],
      });
      state.final = createFinal([finalTopic], [], 0);
      state.final.phase = "result";
    });
    const beforeDone = (await auth.roomsForUser(account.token)).find(
      (room) => room.roomId === solo.roomId,
    )!;
    assert.equal(beforeDone.completed, false);
    assert.equal(beforeDone.score, null);
    await finish(solo.roomId, (state) => {
      state.final!.phase = "done";
    });
    assert.equal(
      (await auth.roomsForUser(account.token)).find((room) => room.roomId === solo.roomId)
        ?.completed,
      true,
    );
    assert.ok(!JSON.stringify(list).includes("tokenHash"));
  } finally {
    await prisma.gameRoom.deleteMany({ where: { id: { in: roomIds } } });
    if (userId) await prisma.userAccount.delete({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
