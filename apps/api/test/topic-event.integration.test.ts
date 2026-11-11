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
import { TopicMinigamesService } from "../src/rooms/topic-minigames.service";
import { MomentService } from "../src/minigames/moment.service";
import { ZoneService } from "../src/minigames/zone.service";
import { ShootingService } from "../src/minigames/shooting.service";
import { FallingFloorService } from "../src/minigames/falling-floor.service";
import type { PrivateRoomState, RoomPack, RoomCommandInput } from "../src/rooms/rooms.types";

for (const gameMode of ["solo", "team"] as const)
  for (const automatic of [false, true])
    for (const topicMinigamesEnabled of [true, false])
      test(`${gameMode} topic minigames ${topicMinigamesEnabled}: completion ${automatic ? "timer" : "next"}: vote, secure shared game, prizes and final standings`, async () => {
        const databaseUrl = process.env.TEST_DATABASE_URL;
        if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
        const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
        await prisma.$connect();
        const moment = new MomentService(),
          zone = new ZoneService(),
          shooting = new ShootingService(),
          floor = new FallingFloorService();
        let now = Date.now();
        shooting.now = () => now;
        const bridge = new TopicMinigamesService(moment, zone, shooting, floor);
        const rooms = new RoomsService(prisma, new PacksRepository(prisma), bridge);
        let roomId: string | undefined;
        try {
          const creator = await rooms.create({
            name: "Испытание темы",
            gameMode,
            teamCount: gameMode === "team" ? 2 : undefined,
            maxPlayers: 4,
            displayName: "Первый",
            requestedRole: "player",
            hostEnabled: true,
            topicMinigamesEnabled,
          });
          roomId = creator.roomId;
          const guests = [];
          for (let i = 0; i < 3; i++)
            guests.push(
              await rooms.join(roomId, { displayName: `Игрок ${i + 2}`, requestedRole: "player" }),
            );
          const host = await rooms.join(roomId, { displayName: "Ведущий", requestedRole: "host" });
          const players = [creator, ...guests];
          const record = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
          const pack = structuredClone(record.pack) as unknown as RoomPack;
          const question = {
            ...pack.topics[0].questions[0],
            id: "only-question",
            type: "choice" as const,
            answerMode: "everyone" as const,
            prompt: "Последний вопрос",
            options: ["Да", "Нет"],
            answer: "Да",
            value: 500,
          };
          pack.topics = [{ ...pack.topics[0], questions: [question] }];
          const state = structuredClone(record.state) as unknown as PrivateRoomState;
          state.hostEnabled = false; // automatic grading; keep a host seat to test voting permissions
          state.phase = "question";
          state.currentQuestionId = question.id;
          state.played = [question.id];
          state.buzzOpensAt = Date.now() - 1000;
          state.deadlineAt = Date.now() + 30000;
          const save = (value: PrivateRoomState) =>
            prisma.gameRoom.update({
              where: { id: roomId },
              data: {
                pack: pack as unknown as Prisma.InputJsonValue,
                state: value as unknown as Prisma.InputJsonValue,
                deadlineAt: null,
              },
            });
          await save(state);
          const command = (
            participantId: string,
            input: Omit<RoomCommandInput, "id">,
            id = randomUUID(),
          ) => rooms.command(roomId!, participantId, { ...input, id });
          for (const player of players)
            assert.equal(
              (await command(player.participantId, { type: "answer", answer: "Да" })).ok,
              true,
            );
          assert.equal((await rooms.publicSnapshot(roomId)).phase, "result");
          for (const player of players) {
            const stats = (await rooms.publicSnapshot(roomId)).statistics.byId[
              player.participantId
            ];
            assert.equal(stats.answered, 1);
            assert.equal(stats.correct, 1);
          }
          if (automatic) {
            const current = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
            const value = structuredClone(current.state) as unknown as PrivateRoomState;
            value.deadlineAt = Date.now() - 1;
            await save(value);
            await rooms.advance(roomId);
          } else assert.equal((await command(creator.participantId, { type: "next" })).ok, true);
          let snapshot = await rooms.publicSnapshot(roomId);
          assert.equal(snapshot.topicMinigamesEnabled, topicMinigamesEnabled);
          if (!topicMinigamesEnabled) {
            assert.equal(snapshot.phase, "board");
            assert.equal(snapshot.completed, true);
            assert.equal(snapshot.topicEvent, undefined);
            assert.equal(
              snapshot.participants
                .filter((person) => person.role === "player")
                .every((person) => person.score === 500),
              true,
            );
            return;
          }
          assert.equal(snapshot.phase, "minigame-vote");
          assert.equal(snapshot.completed, false);
          assert.equal(snapshot.topicEvent?.prize, 500);
          const topicId = snapshot.topicEvent!.topicId;
          assert.equal(
            (
              await command(host.participantId, {
                type: "vote-minigame",
                topicId,
                minigame: "shooting",
              })
            ).ok,
            false,
          );
          assert.equal(
            (
              await command(creator.participantId, {
                type: "vote-minigame",
                topicId: "stale",
                minigame: "shooting",
              })
            ).ok,
            false,
          );
          assert.equal(
            (
              await command(creator.participantId, {
                type: "vote-minigame",
                topicId,
                minigame: "hockey",
              })
            ).ok,
            false,
          );
          assert.equal(
            (await command(creator.participantId, { type: "pick", questionId: question.id })).ok,
            false,
          );
          for (const player of players.slice(0, -1)) {
            const id = randomUUID();
            const input = { type: "vote-minigame" as const, topicId, minigame: "shooting" };
            const ack = await command(player.participantId, input, id);
            assert.equal(ack.ok, true);
            assert.deepEqual(await command(player.participantId, input, id), ack);
            assert.equal((await command(player.participantId, input)).ok, false);
          }
          assert.equal((await rooms.publicSnapshot(roomId)).phase, "minigame-vote");
          assert.equal(
            (
              await command(players.at(-1)!.participantId, {
                type: "vote-minigame",
                topicId,
                minigame: "shooting",
              })
            ).ok,
            true,
          );
          snapshot = await rooms.publicSnapshot(roomId);
          assert.equal(snapshot.phase, "minigame");
          assert.equal(snapshot.topicEvent?.selected, "shooting");
          assert.equal(JSON.stringify(snapshot).includes('"token"'), false);
          await assert.rejects(rooms.topicMinigame(roomId, "invalid"));
          assert.equal((await rooms.topicMinigame(roomId, host.token)).session, null);
          const sessions = [];
          for (const player of players) {
            const session = (await rooms.topicMinigame(roomId, player.token)).session;
            if (session) sessions.push(session);
          }
          assert.equal(new Set(sessions.map((session) => session.roomId)).size, 1);
          assert.equal(
            new Set(sessions.map((session) => session.playerId)).size,
            gameMode === "team" ? 2 : 4,
          );
          const miniId = sessions[0].roomId;
          assert.throws(() => shooting.join(miniId, "Посторонний"));
          for (const session of sessions)
            shooting.connect(miniId, session.playerId, session.playerId, true);
          for (const session of sessions)
            shooting.command(miniId, session.playerId, {
              id: randomUUID(),
              roundId: shooting.snapshot(miniId).roundId,
              type: "ready",
            });
          assert.equal(
            (await command(creator.participantId, { type: "finish-minigame" })).ok,
            false,
          );
          now = shooting.snapshot(miniId).endsAt! + 1;
          await rooms.advance(roomId);
          snapshot = await rooms.publicSnapshot(roomId);
          assert.equal(snapshot.phase, "minigame-result");
          for (const entry of snapshot.topicEvent!.standings!) {
            assert.equal(snapshot.statistics.byId[entry.id].minigamesPlayed, 1);
            assert.equal(
              snapshot.statistics.byId[entry.id].minigamesWon,
              Number(entry.place === 1),
            );
          }
          assert.equal(
            snapshot.topicEvent!.standings!.reduce((sum, entry) => sum + entry.prize, 0),
            500,
          );
          const scores = snapshot.participants.map((person) => person.score);
          await rooms.advance(roomId);
          assert.deepEqual(
            (await rooms.publicSnapshot(roomId)).participants.map((person) => person.score),
            scores,
          );
          assert.throws(() =>
            shooting.command(miniId, sessions[0].playerId, {
              id: randomUUID(),
              roundId: shooting.snapshot(miniId).roundId,
              type: "rematch",
            }),
          );
          assert.equal(
            (await command(creator.participantId, { type: "finish-minigame" })).ok,
            true,
          );
          snapshot = await rooms.publicSnapshot(roomId);
          assert.equal(snapshot.completed, true);
          assert.equal(snapshot.topicEvent, undefined);
          assert.equal((await command(creator.participantId, { type: "next" })).ok, false);
        } finally {
          if (roomId) await prisma.gameRoom.delete({ where: { id: roomId } });
          for (const service of [moment, zone, shooting, floor]) service.onModuleDestroy();
          await prisma.$disconnect();
        }
      });
