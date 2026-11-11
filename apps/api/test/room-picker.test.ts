import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { RoomsService } from "../src/rooms/rooms.service";
import type { PrivateRoomState, RoomPack } from "../src/rooms/rooms.types";
import { PacksRepository } from "../src/workshop/packs.repository";

for (const gameMode of ["solo", "team"] as const) {
  for (const hostEnabled of [false, true]) {
    test(`${gameMode}: topic skip commands enforce unanimous votes or host authority and advance rounds`, async () => {
      const databaseUrl = process.env.TEST_DATABASE_URL;
      if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
      const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
      await prisma.$connect();
      const rooms = new RoomsService(prisma, new PacksRepository(prisma));
      let roomId: string | undefined;
      try {
        const creator = await rooms.create({
          name: "Проверка пропуска темы",
          gameMode,
          maxPlayers: gameMode === "team" ? 4 : 2,
          teamCount: gameMode === "team" ? 2 : undefined,
          hostEnabled,
          displayName: "Создатель",
          requestedRole: "player",
        });
        roomId = creator.roomId;
        const players = [creator.participantId];
        for (let i = 1; i < (gameMode === "team" ? 4 : 2); i++) {
          const person = await rooms.join(roomId, {
            displayName: `Игрок ${i + 1}`,
            requestedRole: "player",
          });
          players.push(person.participantId);
        }
        const host = hostEnabled
          ? await rooms.join(roomId, { displayName: "Ведущий", requestedRole: "host" })
          : undefined;
        const record = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
        const pack = structuredClone(record.pack) as unknown as RoomPack;
        const topic = {
          ...pack.topics[0],
          roundIndex: 0,
          questions: pack.topics[0].questions.slice(0, 2),
        };
        pack.rounds = ["Первый", "Второй"];
        pack.topics = [
          topic,
          {
            ...topic,
            id: "later",
            roundIndex: 1,
            questions: [
              {
                ...topic.questions[0],
                id: "last",
                questionMedia: { id: "next-round-image", kind: "image" },
              },
            ],
          },
        ];
        const state = structuredClone(record.state) as unknown as PrivateRoomState;
        state.phase = "board";
        state.played = [topic.questions[0].id];
        state.pickerId = players[0];
        await prisma.gameRoom.update({
          where: { id: roomId },
          data: {
            state: state as unknown as Prisma.InputJsonValue,
            pack: pack as unknown as Prisma.InputJsonValue,
            deadlineAt: null,
          },
        });
        const command = (participantId: string, topicId = topic.id, id = randomUUID()) =>
          rooms.command(roomId!, participantId, { id, type: "skip-topic", topicId });
        assert.equal((await command(players[0], "later")).ok, false);
        if (host) {
          assert.equal((await command(players[0])).ok, false);
          assert.equal((await command(host.participantId)).ok, true);
        } else {
          const id = randomUUID();
          const first = await command(players[0], topic.id, id);
          assert.equal(first.ok, true);
          assert.deepEqual(await command(players[0], topic.id, id), first);
          assert.equal((await command(players[0])).ok, false);
          for (const playerId of players.slice(1, -1))
            assert.equal((await command(playerId)).ok, true);
          const snapshot = await rooms.publicSnapshot(roomId);
          assert.equal(snapshot.phase, "board");
          assert.equal(snapshot.topics[0].questions[1].played, false);
          assert.equal(snapshot.topicSkipVotes[topic.id].length, players.length - 1);
          assert.equal((await command(players.at(-1)!)).ok, true);
        }
        let snapshot = await rooms.publicSnapshot(roomId);
        assert.equal(snapshot.phase, "loading");
        assert.equal(snapshot.roundIndex, 1);
        assert.ok(snapshot.participants.every((person) => person.score === 0));
        assert.equal(snapshot.pickerId, players[0]);
        assert.deepEqual(snapshot.topicSkipVotes, {});
        assert.equal((await command(host?.participantId ?? players[0], "later")).ok, false);
        for (const person of snapshot.participants)
          assert.equal(
            (
              await rooms.command(roomId, person.id, {
                id: randomUUID(),
                type: "load-progress",
                progress: 100,
              })
            ).ok,
            true,
          );
        snapshot = await rooms.publicSnapshot(roomId);
        assert.equal(snapshot.phase, "board");
        if (host) assert.equal((await command(host.participantId, "later")).ok, true);
        else
          for (const playerId of players) assert.equal((await command(playerId, "later")).ok, true);
        snapshot = await rooms.publicSnapshot(roomId);
        assert.equal(snapshot.completed, true);
        assert.equal(snapshot.currentQuestion, undefined);
        assert.ok(snapshot.participants.every((person) => person.score === 0));
      } finally {
        if (roomId) await prisma.gameRoom.delete({ where: { id: roomId } });
        await prisma.$disconnect();
      }
    });
  }
}

test("each round waits for every participant to preload its own media", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  await prisma.$connect();
  const rooms = new RoomsService(prisma, new PacksRepository(prisma));
  let roomId: string | undefined;
  try {
    const creator = await rooms.create({
      name: "Загрузка раундов",
      gameMode: "solo",
      maxPlayers: 2,
      displayName: "Первый",
      requestedRole: "player",
    });
    roomId = creator.roomId;
    const guest = await rooms.join(roomId, { displayName: "Второй" });
    const record = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
    const pack = structuredClone(record.pack) as unknown as RoomPack;
    const first = pack.topics[0].questions[0];
    first.questionMedia = { id: "first-clip", kind: "audio" };
    first.answerMedia = { id: "first-answer", kind: "image" };
    pack.rounds = ["Первый", "Второй"];
    pack.topics = [
      { ...pack.topics[0], questions: [first], roundIndex: 0 },
      {
        ...pack.topics[0],
        id: "second-topic",
        roundIndex: 1,
        questions: [
          {
            ...first,
            id: "second-question",
            questionMedia: { id: "second-clip", kind: "video" },
            answerMedia: undefined,
          },
        ],
      },
    ];
    await prisma.gameRoom.update({
      where: { id: roomId },
      data: { pack: pack as unknown as Prisma.InputJsonValue },
    });
    const command = (
      participantId: string,
      type: "start" | "load-progress" | "next",
      progress?: number,
    ) => rooms.command(roomId!, participantId, { id: randomUUID(), type, progress });

    assert.equal((await command(creator.participantId, "start")).ok, true);
    let snapshot = await rooms.publicSnapshot(roomId);
    assert.equal(snapshot.phase, "loading");
    assert.equal(snapshot.roundIndex, 0);
    assert.deepEqual(snapshot.topics, []);
    assert.deepEqual(
      snapshot.loadingAssets?.map((asset) => asset.id),
      ["first-clip", "first-answer"],
    );
    assert.equal((await command(creator.participantId, "load-progress", 100)).ok, true);
    assert.equal((await rooms.publicSnapshot(roomId)).phase, "loading");
    assert.equal((await command(guest.participantId, "load-progress", 100)).ok, true);
    assert.equal((await rooms.publicSnapshot(roomId)).phase, "presentation");

    const updated = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
    const state = structuredClone(updated.state) as unknown as PrivateRoomState;
    state.phase = "result";
    state.currentQuestionId = first.id;
    state.played = [first.id];
    await prisma.gameRoom.update({
      where: { id: roomId },
      data: { state: state as unknown as Prisma.InputJsonValue, deadlineAt: null },
    });
    assert.equal((await command(creator.participantId, "next")).ok, true);
    snapshot = await rooms.publicSnapshot(roomId);
    assert.equal(snapshot.phase, "loading");
    assert.equal(snapshot.roundIndex, 1);
    assert.deepEqual(
      snapshot.loadingAssets?.map((asset) => asset.id),
      ["second-clip"],
    );
    assert.equal((await command(creator.participantId, "load-progress", 100)).ok, true);
    assert.equal((await rooms.publicSnapshot(roomId)).phase, "loading");
    assert.equal((await command(guest.participantId, "load-progress", 100)).ok, true);
    assert.equal((await rooms.publicSnapshot(roomId)).phase, "board");
  } finally {
    if (roomId) await prisma.gameRoom.delete({ where: { id: roomId } });
    await prisma.$disconnect();
  }
});

test("only the selected player can pick after the shared roulette ends", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  await prisma.$connect();
  const rooms = new RoomsService(prisma, new PacksRepository(prisma));
  let roomId: string | undefined;
  try {
    const creator = await rooms.create({
      name: "Очередь выбора",
      gameMode: "solo",
      maxPlayers: 2,
      displayName: "Первый",
      requestedRole: "player",
    });
    roomId = creator.roomId;
    const guest = await rooms.join(roomId, { displayName: "Второй" });
    const start = await rooms.command(roomId, creator.participantId, {
      id: randomUUID(),
      type: "start",
    });
    assert.equal(start.ok, true);

    const room = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
    const state = structuredClone(room.state) as unknown as PrivateRoomState;
    assert.ok([creator.participantId, guest.participantId].includes(state.pickerId ?? ""));
    state.phase = "board";
    state.deadlineAt = undefined;
    state.pickerRouletteStartedAt = Date.now();
    state.pickerRouletteEndsAt = Date.now() + 5000;
    await prisma.gameRoom.update({
      where: { id: roomId },
      data: { state: state as unknown as Prisma.InputJsonValue, deadlineAt: null },
    });
    const questionId = (await rooms.publicSnapshot(roomId)).topics[0].questions[0].id;
    const otherId =
      state.pickerId === creator.participantId ? guest.participantId : creator.participantId;
    const wrongPlayer = await rooms.command(roomId, otherId, {
      id: randomUUID(),
      type: "pick",
      questionId,
    });
    assert.equal(wrongPlayer.ok, false);
    assert.match(wrongPlayer.error ?? "", /другой игрок/);
    const tooEarly = await rooms.command(roomId, state.pickerId!, {
      id: randomUUID(),
      type: "pick",
      questionId,
    });
    assert.equal(tooEarly.ok, false);
    assert.match(tooEarly.error ?? "", /окончания выбора/);

    state.pickerRouletteEndsAt = Date.now() - 1;
    await prisma.gameRoom.update({
      where: { id: roomId },
      data: { state: state as unknown as Prisma.InputJsonValue, deadlineAt: null },
    });
    const selected = await rooms.command(roomId, state.pickerId!, {
      id: randomUUID(),
      type: "pick",
      questionId,
    });
    assert.equal(selected.ok, true);
    assert.equal((await rooms.publicSnapshot(roomId)).phase, "question");
  } finally {
    if (roomId) await prisma.gameRoom.delete({ where: { id: roomId } });
    await prisma.$disconnect();
  }
});

test("audio skip requires every participant's vote and rejects duplicates", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  await prisma.$connect();
  const rooms = new RoomsService(prisma, new PacksRepository(prisma));
  let roomId: string | undefined;
  try {
    const host = await rooms.create({
      name: "Пропуск музыки",
      gameMode: "solo",
      maxPlayers: 2,
      displayName: "Ведущий",
      requestedRole: "host",
      hostEnabled: true,
    });
    roomId = host.roomId;
    const first = await rooms.join(roomId, { displayName: "Первый" });
    const second = await rooms.join(roomId, { displayName: "Второй" });
    assert.equal(
      (await rooms.command(roomId, host.participantId, { id: randomUUID(), type: "start" })).ok,
      true,
    );
    const record = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
    const pack = structuredClone(record.pack) as unknown as RoomPack;
    const musical = pack.topics[0].questions[0];
    musical.questionMedia = { id: "clip", kind: "audio", durationSeconds: 30 };
    const state = structuredClone(record.state) as unknown as PrivateRoomState;
    state.phase = "question";
    state.currentQuestionId = musical.id;
    state.openedAt = Date.now();
    state.readingEndsAt = state.openedAt + 32_000;
    state.buzzOpensAt = state.readingEndsAt;
    state.deadlineAt = state.buzzOpensAt + musical.answerTimeSeconds * 1000;
    state.pickerRouletteStartedAt = undefined;
    state.pickerRouletteEndsAt = undefined;
    await prisma.gameRoom.update({
      where: { id: roomId },
      data: {
        pack: pack as unknown as Prisma.InputJsonValue,
        state: state as unknown as Prisma.InputJsonValue,
        deadlineAt: new Date(state.deadlineAt),
      },
    });

    assert.equal(
      (await rooms.command(roomId, host.participantId, { id: randomUUID(), type: "skip-audio" }))
        .ok,
      true,
    );
    assert.equal(
      (await rooms.command(roomId, first.participantId, { id: randomUUID(), type: "skip-audio" }))
        .ok,
      true,
    );
    const waiting = await rooms.publicSnapshot(roomId);
    assert.deepEqual(waiting.audioSkippedPlayers, [host.participantId, first.participantId]);
    assert.equal(waiting.currentQuestion?.buzzOpensAt, state.buzzOpensAt);
    assert.equal(
      (await rooms.command(roomId, first.participantId, { id: randomUUID(), type: "skip-audio" }))
        .ok,
      false,
    );
    assert.equal(
      (await rooms.command(roomId, second.participantId, { id: randomUUID(), type: "skip-audio" }))
        .ok,
      true,
    );
    const skipped = await rooms.publicSnapshot(roomId);
    assert.deepEqual(skipped.audioSkippedPlayers, [
      host.participantId,
      first.participantId,
      second.participantId,
    ]);
    assert.ok(skipped.currentQuestion!.buzzOpensAt < state.buzzOpensAt);
    assert.equal(
      skipped.currentQuestion!.deadlineAt - skipped.currentQuestion!.buzzOpensAt,
      musical.answerTimeSeconds * 1000,
    );
  } finally {
    if (roomId) await prisma.gameRoom.delete({ where: { id: roomId } });
    await prisma.$disconnect();
  }
});

test("team opening roulette grants the first question to the first seat of the chosen team", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  await prisma.$connect();
  const rooms = new RoomsService(prisma, new PacksRepository(prisma));
  let roomId: string | undefined;
  try {
    const creator = await rooms.create({
      name: "Командный первый ход",
      gameMode: "team",
      teamCount: 2,
      maxPlayers: 4,
      displayName: "Первый",
      requestedRole: "player",
    });
    roomId = creator.roomId;
    await rooms.join(roomId, { displayName: "Второй", teamNumber: 1 });
    await rooms.join(roomId, { displayName: "Третий", teamNumber: 2 });
    await rooms.join(roomId, { displayName: "Четвёртый", teamNumber: 2 });
    const start = await rooms.command(roomId, creator.participantId, {
      id: randomUUID(),
      type: "start",
    });
    assert.equal(start.ok, true);
    const snapshot = await rooms.publicSnapshot(roomId);
    const selected = snapshot.participants.find((person) => person.id === snapshot.pickerId);
    assert.ok(selected?.teamId);
    assert.equal(selected.seatNumber, 1);
    assert.equal(
      snapshot.participants.filter(
        (person) => person.role === "player" && person.teamId === selected.teamId,
      ).length,
      2,
    );
    assert.ok(snapshot.pickerRouletteStartedAt);
    assert.ok(snapshot.pickerRouletteEndsAt);
  } finally {
    if (roomId) await prisma.gameRoom.delete({ where: { id: roomId } });
    await prisma.$disconnect();
  }
});

test("a host verdict keeps the next pick with the player judged correct", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  await prisma.$connect();
  const rooms = new RoomsService(prisma, new PacksRepository(prisma));
  let roomId: string | undefined;
  try {
    const host = await rooms.create({
      name: "Проверка передачи хода",
      gameMode: "solo",
      maxPlayers: 2,
      displayName: "Ведущий",
      requestedRole: "host",
      hostEnabled: true,
    });
    roomId = host.roomId;
    const first = await rooms.join(roomId, { displayName: "Первый" });
    const second = await rooms.join(roomId, { displayName: "Второй" });
    assert.equal(
      (await rooms.command(roomId, host.participantId, { id: randomUUID(), type: "start" })).ok,
      true,
    );
    const record = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
    const state = structuredClone(record.state) as unknown as PrivateRoomState;
    state.phase = "question";
    state.currentQuestionId = "mix-0-0";
    state.pickerId = first.participantId;
    state.deadlineAt = Date.now() + 30000;
    state.pickerRouletteStartedAt = undefined;
    state.pickerRouletteEndsAt = undefined;
    await prisma.gameRoom.update({
      where: { id: roomId },
      data: {
        state: state as unknown as Prisma.InputJsonValue,
        deadlineAt: new Date(state.deadlineAt),
      },
    });
    const verdict = await rooms.command(roomId, host.participantId, {
      id: randomUUID(),
      type: "judge-answer",
      targetParticipantId: first.participantId,
      verdict: "correct",
      answer: "Вуди",
    });
    assert.equal(verdict.ok, true);
    const result = await rooms.publicSnapshot(roomId);
    assert.equal(result.phase, "result");
    assert.equal(result.pickerId, first.participantId);
    assert.equal(result.result?.responses[0]?.correct, true);
    assert.notEqual(result.pickerId, second.participantId);
    assert.equal(
      (await rooms.command(roomId, host.participantId, { id: randomUUID(), type: "next" })).ok,
      true,
    );
    assert.equal((await rooms.publicSnapshot(roomId)).pickerId, first.participantId);

    const nextRoom = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
    const nextState = structuredClone(nextRoom.state) as unknown as PrivateRoomState;
    nextState.phase = "question";
    nextState.currentQuestionId = "mix-0-1";
    nextState.buzzWinnerId = second.participantId;
    nextState.buzzRemainingMs = 30000;
    nextState.buzzOpensAt = Date.now() - 1000;
    nextState.deadlineAt = Date.now() + 30000;
    await prisma.gameRoom.update({
      where: { id: roomId },
      data: {
        state: nextState as unknown as Prisma.InputJsonValue,
        deadlineAt: new Date(nextState.deadlineAt),
      },
    });
    assert.equal(
      (
        await rooms.command(roomId, second.participantId, {
          id: randomUUID(),
          type: "answer",
          answer: "Автомобиль",
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await rooms.command(roomId, host.participantId, {
          id: randomUUID(),
          type: "judge-answer",
          targetParticipantId: second.participantId,
          verdict: "correct",
        })
      ).ok,
      true,
    );
    assert.equal((await rooms.publicSnapshot(roomId)).pickerId, second.participantId);

    const multiRoom = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
    const multiPack = structuredClone(multiRoom.pack) as unknown as RoomPack;
    multiPack.topics[0].questions[2].answerMode = "everyone";
    const multiState = structuredClone(multiRoom.state) as unknown as PrivateRoomState;
    multiState.phase = "question";
    multiState.currentQuestionId = "mix-0-2";
    multiState.pickerId = second.participantId;
    multiState.lastJudgedCorrectId = undefined;
    multiState.responses = [];
    multiState.result = undefined;
    multiState.buzzOpensAt = Date.now() - 1000;
    multiState.deadlineAt = Date.now() + 30000;
    await prisma.gameRoom.update({
      where: { id: roomId },
      data: {
        state: multiState as unknown as Prisma.InputJsonValue,
        pack: multiPack as unknown as Prisma.InputJsonValue,
        deadlineAt: new Date(multiState.deadlineAt),
      },
    });
    for (const playerId of [first.participantId, second.participantId]) {
      assert.equal(
        (
          await rooms.command(roomId, playerId, {
            id: randomUUID(),
            type: "answer",
            answer: "Хогвартс",
          })
        ).ok,
        true,
      );
      assert.equal(
        (
          await rooms.command(roomId, host.participantId, {
            id: randomUUID(),
            type: "judge-answer",
            targetParticipantId: playerId,
            verdict: "correct",
          })
        ).ok,
        true,
      );
    }
    assert.equal((await rooms.publicSnapshot(roomId)).pickerId, second.participantId);
  } finally {
    if (roomId) await prisma.gameRoom.delete({ where: { id: roomId } });
    await prisma.$disconnect();
  }
});
