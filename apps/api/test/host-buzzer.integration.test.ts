import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { PacksRepository } from "../src/workshop/packs.repository";
import { RoomsService } from "../src/rooms/rooms.service";
import type { PrivateRoomState, RoomPack, RoomCommandInput } from "../src/rooms/rooms.types";

test("room creation persists rebuzz preference only when a host is enabled", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  await prisma.$connect();
  const rooms = new RoomsService(prisma, new PacksRepository(prisma));
  const ids: string[] = [];
  try {
    for (const hostEnabled of [false, true])
      for (const hostRebuzzEnabled of [false, true, undefined]) {
        const created = await rooms.create({
          name: "Настройки повторного ответа",
          gameMode: "solo",
          maxPlayers: 2,
          displayName: "Первый",
          hostEnabled,
          hostRebuzzEnabled,
        });
        ids.push(created.roomId);
        const snapshot = await rooms.publicSnapshot(created.roomId);
        assert.equal(snapshot.hostRebuzzEnabled, hostEnabled && hostRebuzzEnabled !== false);
        const record = await prisma.gameRoom.findUniqueOrThrow({ where: { id: created.roomId } });
        assert.equal(
          (record.state as unknown as PrivateRoomState).hostRebuzzEnabled,
          snapshot.hostRebuzzEnabled,
        );
      }
  } finally {
    await prisma.gameRoom.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});

for (const gameMode of ["solo", "team"] as const)
  test(`${gameMode}: hosted rebuzz pauses the clock, excludes judged players and settles once`, async (t) => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
    const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
    await prisma.$connect();
    const rooms = new RoomsService(prisma, new PacksRepository(prisma));
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    let roomId: string | undefined;
    try {
      const first = await rooms.create({
        name: "Перехват ответа",
        gameMode,
        maxPlayers: 4,
        displayName: "Первый",
        hostEnabled: true,
      });
      roomId = first.roomId;
      const second = await rooms.join(roomId, { displayName: "Второй" });
      const third = await rooms.join(roomId, { displayName: "Третий" });
      const fourth = await rooms.join(roomId, { displayName: "Четвёртый" });
      const host = await rooms.join(roomId, { displayName: "Ведущий", requestedRole: "host" });
      const record = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
      const pack = structuredClone(record.pack) as unknown as RoomPack;
      const question = {
        ...pack.topics[0].questions[0],
        id: "rebuzz",
        answerMode: "buzzer" as const,
        type: "choice" as const,
        prompt: "Вопрос",
        options: ["Да", "Нет"],
        answer: "Да",
        value: 100,
        answerTimeSeconds: 30,
      };
      pack.topics = [{ ...pack.topics[0], questions: [question] }];
      const save = (state: PrivateRoomState) =>
        prisma.gameRoom.update({
          where: { id: roomId },
          data: {
            pack: pack as unknown as Prisma.InputJsonValue,
            state: state as unknown as Prisma.InputJsonValue,
            deadlineAt: null,
          },
        });
      const initial = {
        ...(structuredClone(record.state) as unknown as PrivateRoomState),
        phase: "question" as const,
        currentQuestionId: question.id,
        played: [question.id],
        openedAt: now - 5000,
        buzzOpensAt: now - 1000,
        deadlineAt: now + 17400,
      };
      await save(initial);
      const command = (
        participantId: string,
        input: Omit<RoomCommandInput, "id">,
        id = randomUUID(),
      ) => rooms.command(roomId!, participantId, { ...input, id });
      const buzz = async (playerId: string) => {
        assert.equal((await command(playerId, { type: "buzz" })).ok, true);
        now += 121;
        await rooms.advance(roomId!);
        assert.equal((await rooms.publicSnapshot(roomId!)).buzzWinnerId, playerId);
      };
      await buzz(first.participantId);
      let snapshot = await rooms.publicSnapshot(roomId);
      assert.equal(snapshot.currentQuestion?.buzzRemainingMs, 17400);
      assert.equal(snapshot.currentQuestion?.deadlineAt, undefined);
      now += 60000;
      await rooms.advance(roomId);
      assert.equal((await rooms.publicSnapshot(roomId)).phase, "question");
      assert.equal(
        (await command(second.participantId, { type: "answer", answer: "Да" })).ok,
        false,
      );
      assert.equal(
        (
          await command(host.participantId, {
            type: "judge-answer",
            targetParticipantId: second.participantId,
            verdict: "correct",
          })
        ).ok,
        false,
      );
      assert.equal(
        (await command(first.participantId, { type: "answer", answer: "Нет" })).ok,
        true,
      );
      const wrong = {
        type: "judge-answer" as const,
        targetParticipantId: first.participantId,
        verdict: "incorrect" as const,
      };
      const commandId = randomUUID();
      assert.equal((await command(host.participantId, wrong, commandId)).ok, true);
      assert.equal((await command(host.participantId, wrong, commandId)).ok, true);
      snapshot = await rooms.publicSnapshot(roomId);
      assert.equal(snapshot.phase, "question");
      assert.equal(snapshot.result, undefined);
      assert.equal(snapshot.currentQuestion?.deadlineAt, now + 17400);
      assert.equal(snapshot.participants.find((p) => p.id === first.participantId)?.score, -100);
      assert.equal((await command(first.participantId, { type: "buzz" })).ok, false);
      now += 2450;
      await buzz(second.participantId);
      assert.equal((await rooms.publicSnapshot(roomId)).currentQuestion?.buzzRemainingMs, 14950);
      now += 40000;
      assert.equal(
        (
          await command(host.participantId, {
            type: "judge-answer",
            targetParticipantId: second.participantId,
            verdict: "incorrect",
          })
        ).ok,
        true,
      );
      now += 1000;
      await buzz(third.participantId);
      assert.equal(
        (
          await command(host.participantId, {
            type: "judge-answer",
            targetParticipantId: third.participantId,
            verdict: "correct",
            scoreMultiplier: 2,
          })
        ).ok,
        true,
      );
      snapshot = await rooms.publicSnapshot(roomId);
      assert.equal(snapshot.phase, "result");
      assert.equal(snapshot.result?.responses.length, 3);
      assert.equal(snapshot.participants.find((p) => p.id === third.participantId)?.score, 200);
      assert.equal((await command(fourth.participantId, { type: "buzz" })).ok, false);
      // An expired window cannot be reopened by a late press or a wrong verdict.
      await save({ ...initial, deadlineAt: now - 1 });
      assert.equal((await command(first.participantId, { type: "buzz" })).ok, false);
      assert.equal((await command(host.participantId, wrong)).ok, true);
      assert.equal((await rooms.publicSnapshot(roomId)).phase, "result");
      // The same hosted question must settle immediately when retries are disabled.
      await save({ ...initial, hostRebuzzEnabled: false, deadlineAt: now + 17400 });
      await buzz(first.participantId);
      assert.equal((await command(host.participantId, wrong)).ok, true);
      snapshot = await rooms.publicSnapshot(roomId);
      assert.equal(snapshot.hostRebuzzEnabled, false);
      assert.equal(snapshot.phase, "result");
      assert.equal((await command(second.participantId, { type: "buzz" })).ok, false);
    } finally {
      if (roomId) await prisma.gameRoom.delete({ where: { id: roomId } });
      await prisma.$disconnect();
    }
  });
