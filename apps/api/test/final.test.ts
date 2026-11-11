import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { RoomsService } from "../src/rooms/rooms.service";
import { PacksRepository } from "../src/workshop/packs.repository";
import { PacksService } from "../src/workshop/packs.service";
import { MediaService } from "../src/workshop/media.service";
import { MediaRepository } from "../src/workshop/media.repository";
import type { PrivateRoomState, RoomPack } from "../src/rooms/rooms.types";

for (const mode of ["score", "achievements"] as const) {
  test(`network final conceals score wagers only in score mode and settles once (${mode})`, async () => {
    const prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.TEST_DATABASE_URL }),
    );
    await prisma.$connect();
    const rooms = new RoomsService(prisma, new PacksRepository(prisma));
    let roomId: string | undefined;
    try {
      const a = await rooms.create({
        name: "Финал",
        gameMode: "solo",
        maxPlayers: 2,
        hostEnabled: false,
        displayName: "А",
      });
      roomId = a.roomId;
      const b = await rooms.join(roomId, { displayName: "Б" });
      const pack: RoomPack = {
        id: "test",
        title: "Финал",
        topics: [
          {
            id: "regular",
            title: "Разминка",
            questions: [
              {
                id: "warmup",
                type: "text",
                answerMode: "everyone",
                answerTimeSeconds: 30,
                value: 100,
                prompt: "Обычный вопрос",
                options: [],
                answer: "Да",
                acceptedAnswers: [],
              },
            ],
          },
          ...["Биология", "Математика", "Картинка"].map((title, i) => ({
            id: String(i),
            title,
            isFinal: true,
            questions: [
              {
                id: "q" + i,
                type: "choice" as const,
                answerMode: "everyone" as const,
                answerTimeSeconds: 30,
                value: 100,
                prompt: "Скрытый вопрос",
                options: ["Верно", "Ошибка"],
                answer: "Верно",
                acceptedAnswers: [],
              },
            ],
          })),
        ],
      };
      const record = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
      const state = record.state as unknown as PrivateRoomState;
      state.victory = { mode, criteria: ["score"] };
      state.phase = "board";
      state.pickerId = a.participantId;
      await prisma.gameRoom.update({
        where: { id: roomId },
        data: {
          state: state as unknown as Prisma.InputJsonValue,
          pack: pack as unknown as Prisma.InputJsonValue,
        },
      });
      const send = (
        id: string,
        finalCommand: import("@qwiza/minigames").FinalCommand,
        commandId = randomUUID(),
      ) => rooms.command(roomId!, id, { id: commandId, type: "final", finalCommand });
      await prisma.gameParticipant.update({ where: { id: a.participantId }, data: { score: 20 } });
      await prisma.gameParticipant.update({ where: { id: b.participantId }, data: { score: 10 } });
      for (const player of [a, b])
        assert.equal(
          (
            await rooms.command(roomId, player.participantId, {
              id: randomUUID(),
              type: "skip-topic",
              topicId: "regular",
            })
          ).ok,
          true,
        );
      const expireStage = async () => {
        const record = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId! } });
        const state = record.state as unknown as PrivateRoomState;
        state.final!.deadlineAt = Date.now() - 1;
        state.deadlineAt = state.final!.deadlineAt;
        await prisma.gameRoom.update({
          where: { id: roomId! },
          data: {
            state: state as unknown as Prisma.InputJsonValue,
            deadlineAt: new Date(state.deadlineAt),
          },
        });
        return rooms.snapshot(roomId!, a.token);
      };
      let view = await rooms.publicSnapshot(roomId);
      assert.equal(view.final?.phase, "intro");
      view = await expireStage();
      assert.equal(view.final?.phase, "vote");
      assert.equal(view.phase, "final");
      assert.equal(view.final?.question, undefined);
      await send(a.participantId, { type: "vote", topicId: "0" });
      await send(b.participantId, { type: "vote", topicId: "0" });
      view = await rooms.publicSnapshot(roomId);
      assert.equal(view.final?.phase, "reveal");
      await expireStage();
      await send(a.participantId, { type: "bet", stake: 20 });
      await send(b.participantId, { type: "bet", stake: 10 });
      view = await rooms.publicSnapshot(roomId);
      assert.equal(view.final?.phase, "answer");
      assert.deepEqual(view.final?.bets, {});
      assert.equal(view.final?.correctAnswer, undefined);
      await send(a.participantId, { type: "answer", answer: "Верно" });
      view = await rooms.publicSnapshot(roomId);
      assert.deepEqual(view.final?.responses, {});
      const id = randomUUID();
      const ack = await send(b.participantId, { type: "answer", answer: "Ошибка" }, id);
      assert.equal(ack.ok, true);
      await send(b.participantId, { type: "answer", answer: "Ошибка" }, id);
      view = await rooms.publicSnapshot(roomId);
      assert.equal(view.final?.responses[a.participantId].delta, mode === "score" ? undefined : 20);
      assert.equal(
        view.final?.responses[b.participantId].delta,
        mode === "score" ? undefined : -10,
      );
      assert.equal(
        view.participants.find((p) => p.id === a.participantId)?.score,
        mode === "score" ? 0 : 40,
      );
      assert.equal(
        (await prisma.gameParticipant.findUniqueOrThrow({ where: { id: a.participantId } })).score,
        40,
      );
      if (mode === "score") {
        assert.deepEqual(view.final?.bets, {});
        assert.equal(view.statistics, undefined);
      }

      await send(a.participantId, { type: "continue" });
      view = await rooms.publicSnapshot(roomId);
      assert.equal(view.completed, true);
      assert.equal(view.summary?.standings.find((p) => p.id === a.participantId)?.place, 1);
      assert.equal(view.summary?.standings.find((p) => p.id === b.participantId)?.place, 2);
      if (mode === "score")
        assert.ok(
          view.summary?.standings.every(
            (p) =>
              p.score === 0 && p.stats.earned === 0 && p.stats.lost === 0 && p.stats.peak === 0,
          ),
        );
    } finally {
      if (roomId) await prisma.gameRoom.delete({ where: { id: roomId } });
      await prisma.$disconnect();
    }
  });
}

test("workshop saves final topics independently from regular round limits", async () => {
  const config = new ConfigService({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const prisma = new PrismaService(config);
  await prisma.$connect();
  const repository = new PacksRepository(prisma);
  const packs = new PacksService(repository, new MediaService(config, new MediaRepository(prisma)));
  let id: string | undefined;
  try {
    const topic = (isFinal: boolean) => ({
      title: isFinal ? "Финальная тема" : "Обычная",
      isFinal,
      roundIndex: 0,
      ordered: false,
      direction: "forward" as const,
      questions: [
        {
          type: "text" as const,
          answerMode: "everyone" as const,
          answerTimeSeconds: 30,
          value: 100,
          promptText: "Вопрос",
          answerText: "Ответ",
          acceptedAnswers: [],
          choices: [],
          correctChoiceIndex: null,
        },
      ],
    });
    const saved = await packs.create({
      title: "Финал",
      description: "",
      rounds: ["Раунд"],
      topics: [
        ...Array.from({ length: 6 }, () => topic(false)),
        ...Array.from({ length: 3 }, () => topic(true)),
      ],
    });
    id = saved.id;
    const loaded = await packs.get(id);
    assert.equal(loaded.topics.filter((t) => t.isFinal).length, 3);
    assert.equal((await packs.check(loaded)).valid, true);
  } finally {
    if (id) await prisma.pack.delete({ where: { id } });
    await prisma.$disconnect();
  }
});
