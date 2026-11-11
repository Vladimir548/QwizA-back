import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Prisma } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { RoomsService } from "../src/rooms/rooms.service";
import { PacksRepository } from "../src/workshop/packs.repository";
import { CreateRoomDto } from "../src/rooms/rooms.dto";
import type { PrivateRoomState, RoomPack } from "../src/rooms/rooms.types";

for (const gameMode of ["solo", "team"] as const)
  test(`${gameMode}: statistics survive settlement, manual corrections, repeated commands and service recreation`, async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL required");
    const prisma = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await prisma.$connect();
    const rooms = new RoomsService(prisma, new PacksRepository(prisma));
    let id: string | undefined;
    try {
      const first = await rooms.create({
        name: "Итоги",
        gameMode,
        maxPlayers: 4,
        displayName: "Первый",
        hostEnabled: true,
        topicMinigamesEnabled: false,
      });
      id = first.roomId;
      const second = await rooms.join(id, {
        displayName: "Второй",
        teamNumber: gameMode === "team" ? 1 : undefined,
      });
      const third = await rooms.join(id, {
        displayName: "Третий",
        teamNumber: gameMode === "team" ? 2 : undefined,
      });
      const fourth = await rooms.join(id, {
        displayName: "Четвёртый",
        teamNumber: gameMode === "team" ? 2 : undefined,
      });
      const host = await rooms.join(id, { displayName: "Ведущий", requestedRole: "host" });
      const victory = {
        mode: "achievements" as const,
        criteria: ["score", "correct", "earned"] as const,
      };
      const command = (actor: string, input: Record<string, unknown>, commandId = randomUUID()) =>
        rooms.command(id!, actor, { ...input, id: commandId } as Parameters<
          RoomsService["command"]
        >[2]);
      assert.equal(
        (await command(second.participantId, { type: "set-victory-rules", victory })).ok,
        false,
      );
      assert.equal(
        (
          await command(first.participantId, {
            type: "set-victory-rules",
            victory: { ...victory, criteria: [] },
          })
        ).ok,
        false,
      );
      assert.equal(
        (await command(first.participantId, { type: "set-victory-rules", victory })).ok,
        true,
      );
      const record = await prisma.gameRoom.findUniqueOrThrow({ where: { id } });
      const pack = structuredClone(record.pack) as unknown as RoomPack;
      const question = {
        ...pack.topics[0].questions[0],
        id: "stats-q",
        value: 100,
        type: "choice" as const,
        answerMode: "everyone" as const,
        prompt: "Вопрос",
        options: ["Да", "Нет"],
        answer: "Да",
      };
      pack.topics = [{ ...pack.topics[0], questions: [question] }];
      const state = {
        ...(structuredClone(record.state) as unknown as PrivateRoomState),
        phase: "question" as const,
        currentQuestionId: question.id,
        played: [question.id],
        readingEndsAt: Date.now() - 1,
        deadlineAt: Date.now() + 60000,
      };
      await prisma.gameRoom.update({
        where: { id },
        data: {
          pack: pack as unknown as Prisma.InputJsonValue,
          state: state as unknown as Prisma.InputJsonValue,
        },
      });
      assert.equal(
        (await command(host.participantId, { type: "set-victory-rules", victory })).ok,
        false,
      );
      for (const [person, correct] of [
        [first, false],
        [second, true],
        [third, false],
        [fourth, true],
      ] as const) {
        const cmdId = randomUUID();
        const input = {
          type: "judge-answer",
          targetParticipantId: person.participantId,
          verdict: correct ? "correct" : "incorrect",
          answer: "Устный ответ",
        };
        assert.equal((await command(host.participantId, input, cmdId)).ok, true);
        assert.equal((await command(host.participantId, input, cmdId)).ok, true);
      }
      let snapshot = await rooms.publicSnapshot(id);
      assert.equal(snapshot.statistics.byId[first.participantId].answered, 1);
      assert.equal(snapshot.statistics.byId[first.participantId].lost, 100);
      assert.equal(snapshot.statistics.byId[second.participantId].correct, 1);
      assert.equal(snapshot.statistics.byId[second.participantId].earned, 100);
      const target = gameMode === "team" ? "team-1" : second.participantId;
      if (gameMode === "team") {
        assert.equal(snapshot.statistics.byId[target].answered, 1);
        assert.equal(snapshot.statistics.byId[target].correct, 1);
      }
      assert.equal(
        (
          await command(
            host.participantId,
            gameMode === "team"
              ? { type: "set-team-score", teamNumber: 1, score: 500 }
              : { type: "set-score", targetParticipantId: target, score: 500 },
          )
        ).ok,
        true,
      );
      assert.equal((await command(host.participantId, { type: "next" })).ok, true);
      snapshot = await new RoomsService(prisma, new PacksRepository(prisma)).publicSnapshot(id);
      assert.equal(snapshot.completed, true);
      assert.equal(snapshot.statistics.byId[target].earned, 100);
      assert.equal(snapshot.statistics.byId[target].adjustments, gameMode === "team" ? 500 : 400);
      assert.equal(snapshot.statistics.byId[target].peak, 500);
      assert.equal(snapshot.summary?.incomplete, false);
      assert.doesNotMatch(JSON.stringify(snapshot.summary), /tokenHash|userId|passwordHash/);
      assert.deepEqual(snapshot.summary?.rules.criteria, victory.criteria);
      assert.equal(snapshot.summary?.standings[0].id, target);
    } finally {
      if (id) await prisma.gameRoom.delete({ where: { id } });
      await prisma.$disconnect();
    }
  });

test("room DTO rejects malformed victory settings before a room is created", async () => {
  for (const victory of [
    { mode: "bad", criteria: ["score"] },
    { mode: "score", criteria: [] },
    { mode: "score", criteria: ["score", "score"] },
    { mode: "achievements", criteria: ["forged"] },
  ]) {
    const dto = plainToInstance(CreateRoomDto, {
      name: "Игра",
      gameMode: "solo",
      maxPlayers: 2,
      displayName: "Игрок",
      victory,
    });
    assert.ok((await validate(dto)).some((error) => error.property === "victory"));
  }
});
