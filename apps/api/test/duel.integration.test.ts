import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { createTwentyOneMatch, twentyOneDeck, type TwentyOneFace } from "@qwiza/minigames";
import { Prisma } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { PacksRepository } from "../src/workshop/packs.repository";
import { RoomsService } from "../src/rooms/rooms.service";
import { TopicMinigamesService } from "../src/rooms/topic-minigames.service";
import { MomentService } from "../src/minigames/moment.service";
import { ZoneService } from "../src/minigames/zone.service";
import { ShootingService } from "../src/minigames/shooting.service";
import { FallingFloorService } from "../src/minigames/falling-floor.service";
import { MemoryService } from "../src/minigames/memory.service";
import { HockeyService } from "../src/minigames/hockey.service";
import { TwentyOneService } from "../src/minigames/twenty-one.service";
import { NumberHuntService } from "../src/minigames/number-hunt.service";
import type { PrivateRoomState, RoomCommandInput, RoomPack } from "../src/rooms/rooms.types";

class FixedTwentyOne extends TwentyOneService {
  draw = false;
  protected newMatch(_settings: undefined, roundId: string) {
    const top: TwentyOneFace[] = [
      { rank: "10", suit: "spades" },
      { rank: "9", suit: "spades" },
      { rank: "9", suit: "hearts" },
      { rank: this.draw ? "10" : "7", suit: "hearts" },
    ];
    return createTwentyOneMatch(roundId, [
      ...top,
      ...twentyOneDeck((n) => n - 1).filter(
        (c) => !top.some((t) => t.rank === c.rank && t.suit === c.suit),
      ),
    ]);
  }
}
for (const mode of ["solo", "team"] as const)
  for (const draw of [false, true])
    test(`${mode} duel: consent, private sessions, ${draw ? "draw refund" : "zero-sum stake transfer"}, idempotency and return to board`, async () => {
      const prisma = new PrismaService(
        new ConfigService({ DATABASE_URL: process.env.TEST_DATABASE_URL! }),
      );
      await prisma.$connect();
      const moment = new MomentService(),
        zone = new ZoneService(),
        shooting = new ShootingService(),
        floor = new FallingFloorService(),
        memory = new MemoryService(),
        hockey = new HockeyService(),
        cards = new FixedTwentyOne(),
        numbers = new NumberHuntService();
      const services = [moment, zone, shooting, floor, memory, hockey, cards, numbers];
      const bridge = new TopicMinigamesService(
        moment,
        zone,
        shooting,
        floor,
        memory,
        hockey,
        cards,
        numbers,
      );
      const rooms = new RoomsService(prisma, new PacksRepository(prisma), bridge);
      cards.draw = draw;
      let now = Date.now();
      cards.now = () => now;
      let roomId: string | undefined;
      try {
        const first = await rooms.create({
          name: "Дуэль",
          gameMode: mode,
          teamCount: mode === "team" ? 2 : undefined,
          maxPlayers: 4,
          displayName: "Первый",
          requestedRole: "player",
          hostEnabled: true,
        });
        roomId = first.roomId;
        const sessions = [first];
        for (let i = 0; i < 3; i++)
          sessions.push(
            await rooms.join(roomId, { displayName: `Игрок ${i + 2}`, requestedRole: "player" }),
          );
        const host = await rooms.join(roomId, { displayName: "Ведущий", requestedRole: "host" });
        const record = await prisma.gameRoom.findUniqueOrThrow({
          where: { id: roomId },
          include: { participants: true },
        });
        const self = record.participants.find((p) => p.id === first.participantId)!;
        const opponent = sessions.find(
          (s) =>
            s.participantId !== first.participantId &&
            (mode === "solo" ||
              record.participants.find((p) => p.id === s.participantId)!.teamId !== self.teamId),
        )!;
        const state = structuredClone(record.state) as unknown as PrivateRoomState;
        state.phase = "board";
        state.powersEnabled = true;
        state.duelChallenges = { [first.participantId]: true };
        await prisma.gameRoom.update({
          where: { id: roomId },
          data: { state: state as unknown as Prisma.InputJsonValue, deadlineAt: null },
        });
        await prisma.gameParticipant.updateMany({
          where: { roomId, role: "player" },
          data: { score: 10000 },
        });
        const command = (actor: string, input: Omit<RoomCommandInput, "id">, id = randomUUID()) =>
          rooms.command(roomId!, actor, { ...input, id });
        const offer = {
          type: "offer-duel" as const,
          targetParticipantId: opponent.participantId,
          minigame: "twenty-one",
          stake: mode === "team" ? 6000 : 3000,
        };
        assert.equal(
          (await command(first.participantId, { ...offer, stake: offer.stake + 1 })).ok,
          false,
        );
        assert.equal(
          (await command(first.participantId, { ...offer, minigame: "zone" })).ok,
          false,
        );
        if (mode === "team")
          assert.equal(
            (
              await command(first.participantId, {
                ...offer,
                targetParticipantId: sessions.find(
                  (s) =>
                    s !== first &&
                    record.participants.find((p) => p.id === s.participantId)!.teamId ===
                      self.teamId,
                )!.participantId,
              })
            ).ok,
            false,
          );
        assert.equal((await command(first.participantId, offer)).ok, true);
        let snapshot = await rooms.publicSnapshot(roomId);
        let duelId = snapshot.duel!.id;
        assert.equal(
          (await command(host.participantId, { type: "accept-duel", duelId })).ok,
          false,
        );
        assert.equal(
          (await command(opponent.participantId, { type: "decline-duel", duelId })).ok,
          true,
        );
        assert.equal(
          (await rooms.publicSnapshot(roomId)).duelChallenges[first.participantId],
          true,
        );
        assert.equal((await command(first.participantId, offer)).ok, true);
        duelId = (await rooms.publicSnapshot(roomId)).duel!.id;
        const acceptId = randomUUID();
        const accepted = await command(
          opponent.participantId,
          { type: "accept-duel", duelId },
          acceptId,
        );
        assert.equal(accepted.ok, true);
        assert.deepEqual(
          await command(opponent.participantId, { type: "accept-duel", duelId }, acceptId),
          accepted,
        );
        snapshot = await rooms.publicSnapshot(roomId);
        assert.equal(snapshot.phase, "duel");
        assert.equal(snapshot.duelChallenges[first.participantId], false);
        assert.equal(JSON.stringify(snapshot).includes('"token"'), false);
        assert.equal(
          (
            await command(host.participantId, {
              type: "set-score",
              targetParticipantId: first.participantId,
              score: 0,
            })
          ).ok,
          false,
        );
        await assert.rejects(rooms.duelMinigame(roomId, "invalid"));
        const a = (await rooms.duelMinigame(roomId, first.token)).session!;
        const b = (await rooms.duelMinigame(roomId, opponent.token)).session!;
        assert.equal(a.roomId, b.roomId);
        assert.equal((await rooms.duelMinigame(roomId, host.token)).session, null);
        assert.throws(() => cards.join(a.roomId, "Посторонний"));
        for (const s of [a, b]) cards.connect(a.roomId, s.playerId, s.playerId, true);
        for (const s of [a, b])
          cards.command(a.roomId, s.playerId, {
            id: randomUUID(),
            roundId: cards.snapshot(a.roomId).roundId,
            type: "ready",
          });
        now = Math.max(...cards.snapshot(a.roomId).players.map((p) => p.busyUntil!)) + 1;
        const privateView = await rooms.duelMinigame(roomId, first.token);
        assert.ok(
          privateView.snapshot.players.find(
            (p) => p.id === b.playerId && "cards" in p && p.cards.every((c) => c.face === null),
          ),
        );
        for (const s of [a, b]) {
          const v = cards.snapshot(a.roomId, s.playerId);
          cards.command(a.roomId, s.playerId, {
            id: randomUUID(),
            roundId: v.roundId,
            type: "stand",
            handVersion: v.players.find((p) => p.id === s.playerId)!.handVersion,
          });
        }
        now = cards.snapshot(a.roomId).resolvesAt! + 1;
        await rooms.advance(roomId);
        snapshot = await rooms.publicSnapshot(roomId);
        assert.equal(snapshot.phase, "duel-result");
        assert.equal(snapshot.statistics.byId[first.participantId].minigamesPlayed, 1);
        assert.equal(snapshot.statistics.byId[first.participantId].minigamesWon, draw ? 0 : 1);
        assert.equal(snapshot.statistics.byId[first.participantId].duelsWon, draw ? 0 : 1);
        assert.equal(snapshot.statistics.byId[first.participantId].earned, draw ? 0 : offer.stake);
        assert.equal(snapshot.statistics.byId[opponent.participantId].lost, draw ? 0 : offer.stake);
        assert.equal(snapshot.duel?.winnerId, draw ? null : first.participantId);
        assert.equal(
          snapshot.participants.find((p) => p.id === first.participantId)!.score,
          10000 + (draw ? 0 : offer.stake),
        );
        assert.equal(
          snapshot.participants.find((p) => p.id === opponent.participantId)!.score,
          10000 - (draw ? 0 : offer.stake),
        );
        assert.equal(
          snapshot.participants.reduce((sum, p) => sum + p.score, 0),
          40000,
        );
        const scores = snapshot.participants.map((p) => p.score);
        await rooms.advance(roomId);
        assert.deepEqual(
          (await rooms.publicSnapshot(roomId)).participants.map((p) => p.score),
          scores,
        );
        assert.throws(() =>
          cards.command(a.roomId, a.playerId, {
            id: randomUUID(),
            roundId: cards.snapshot(a.roomId).roundId,
            type: "rematch",
          }),
        );
        assert.equal(
          (await command(first.participantId, { type: "finish-duel", duelId })).ok,
          true,
        );
        assert.equal((await rooms.publicSnapshot(roomId)).phase, "board");
        assert.equal((await command(first.participantId, offer)).ok, false);
        const closed = await prisma.gameRoom.findUniqueOrThrow({ where: { id: roomId } });
        const finalState = structuredClone(closed.state) as unknown as PrivateRoomState;
        finalState.duelChallenges = { [first.participantId]: true };
        finalState.played = (record.pack as unknown as RoomPack).topics.flatMap((t) =>
          t.questions.map((q) => q.id),
        );
        await prisma.gameRoom.update({
          where: { id: roomId },
          data: { state: finalState as unknown as Prisma.InputJsonValue },
        });
        assert.equal((await rooms.publicSnapshot(roomId)).completed, true);
        assert.equal((await command(first.participantId, offer)).ok, false);
      } finally {
        if (roomId) await prisma.gameRoom.delete({ where: { id: roomId } });
        services.forEach((s) => s.onModuleDestroy());
        await prisma.$disconnect();
      }
    });
