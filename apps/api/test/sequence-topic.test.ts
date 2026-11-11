import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { awardTopicPrizes, type TopicMinigameEvent } from "@qwiza/minigames";
import { TopicMinigamesService } from "../src/rooms/topic-minigames.service";
import { MomentService } from "../src/minigames/moment.service";
import { ZoneService } from "../src/minigames/zone.service";
import { ShootingService } from "../src/minigames/shooting.service";
import { FallingFloorService } from "../src/minigames/falling-floor.service";
import { SequenceService } from "../src/minigames/sequence.service";

test("a sealed topic sequence game maps ten-round co-winners back to quiz participants and splits the full fund", () => {
  const moment = new MomentService(),
    zone = new ZoneService(),
    shooting = new ShootingService(),
    floor = new FallingFloorService(),
    sequence = new SequenceService();
  let now = 1000;
  sequence.now = () => now;
  const bridge = new TopicMinigamesService(
    moment,
    zone,
    shooting,
    floor,
    undefined,
    undefined,
    undefined,
    undefined,
    sequence,
  );
  const players = [
    { id: "one", name: "Аня" },
    { id: "two", name: "Макс" },
    { id: "three", name: "Ника" },
  ];
  const event: TopicMinigameEvent = {
    topicId: "topic",
    title: "Тема",
    roundIndex: 0,
    prize: 101,
    options: ["sequence"],
    selected: "sequence",
    participantIds: players.map((p) => p.id),
    voterIds: players.map((p) => p.id),
    votes: {},
  };
  try {
    const match = bridge.ensure("quiz", event, players),
      sessions = Object.values(match.sessions),
      id = sessions[0].roomId;
    assert.equal(bridge.view("quiz", event, players).session, null);
    assert.equal(
      bridge.view("quiz", event, players, "one").session?.playerId,
      match.sessions.one.playerId,
    );
    for (const [index, s] of sessions.entries()) {
      sequence.connect(id, s.playerId, `s${index}`, true);
    }
    for (const s of sessions) {
      sequence.command(id, s.playerId, {
        id: randomUUID(),
        roundId: sequence.snapshot(id).roundId,
        type: "ready",
      });
    }
    for (let round = 1; round <= 10; round++) {
      const shown = sequence.snapshot(id);
      const answer = [...shown.sequence!];
      now = shown.deadline!;
      for (const s of sessions)
        sequence.command(id, s.playerId, {
          id: randomUUID(),
          roundId: shown.roundId,
          type: "submit",
          round,
          answer,
        });
      const next = sequence.snapshot(id);
      if (next.phase === "between") {
        now = next.deadline!;
        sequence.snapshot(id);
      }
    }
    const view = bridge.view("quiz", event, players);
    assert.equal(view.snapshot.phase, "complete");
    assert.deepEqual(
      view.points.map((p) => p.participantId),
      ["one", "two", "three"],
    );
    const prizes = awardTopicPrizes(
      view.points.map((p) => ({ id: p.participantId, name: p.participantId, points: p.points })),
      event.prize,
      event.selected,
    );
    assert.ok(prizes.every((p) => p.place === 1));
    assert.equal(
      prizes.reduce((total, p) => total + p.prize, 0),
      101,
    );
    assert.ok(
      Math.max(...prizes.map((p) => p.prize)) - Math.min(...prizes.map((p) => p.prize)) <= 1,
    );
    assert.throws(() =>
      sequence.command(id, sessions[0].playerId, {
        id: randomUUID(),
        roundId: view.snapshot.roundId,
        type: "rematch",
      }),
    );
  } finally {
    for (const service of [moment, zone, shooting, floor, sequence]) service.onModuleDestroy();
  }
});
