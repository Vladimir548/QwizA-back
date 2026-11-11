import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MomentService } from "../src/minigames/moment.service";
import { ZoneService } from "../src/minigames/zone.service";

test("twelve-player moment waits for every ready and every stop, then grades the full table", () => {
  const service = new MomentService();
  let now = 1000;
  service.now = () => now;
  try {
    const first = service.create("Первый", { roundCount: 3 });
    const sessions = [first];
    for (let i = 1; i < 12; i++) sessions.push(service.join(first.roomId, `Игрок ${i}`));
    for (const session of sessions)
      service.connect(first.roomId, session.playerId, session.playerId, true);
    for (const session of sessions.slice(0, -1))
      service.command(first.roomId, session.playerId, {
        id: randomUUID(),
        roundId: service.snapshot(first.roomId).roundId,
        type: "ready",
      });
    assert.equal(service.snapshot(first.roomId).phase, "lobby");
    service.command(first.roomId, sessions.at(-1)!.playerId, {
      id: randomUUID(),
      roundId: service.snapshot(first.roomId).roundId,
      type: "ready",
    });
    const snapshot = service.snapshot(first.roomId);
    now = snapshot.startsAt! + snapshot.settings.targetMs;
    for (const session of sessions.slice(0, -1))
      service.command(first.roomId, session.playerId, {
        id: randomUUID(),
        roundId: snapshot.roundId,
        type: "stop",
        elapsedMs: snapshot.settings.targetMs,
      });
    assert.equal(service.snapshot(first.roomId).phase, "running");
    assert.equal(service.snapshot(first.roomId).result, null);
    service.command(first.roomId, sessions.at(-1)!.playerId, {
      id: randomUUID(),
      roundId: snapshot.roundId,
      type: "stop",
      elapsedMs: snapshot.settings.targetMs,
    });
    const result = service.snapshot(first.roomId);
    assert.equal(result.phase, "result");
    assert.equal(result.result?.attempts.length, 12);
    assert.equal(result.result?.winnerIds.length, 12);
    assert.ok(result.players.every((player) => player.score === 1));
  } finally {
    service.onModuleDestroy();
  }
});

test("twelve-player zone starts together while hits update only their owner's progress", () => {
  const service = new ZoneService();
  let now = 1000;
  service.now = () => now;
  try {
    const first = service.create("Первый", undefined);
    const sessions = [first];
    for (let i = 1; i < 12; i++) sessions.push(service.join(first.roomId, `Игрок ${i}`));
    for (const session of sessions)
      service.connect(first.roomId, session.playerId, session.playerId, true);
    for (const session of sessions)
      service.command(first.roomId, session.playerId, {
        id: randomUUID(),
        roundId: service.snapshot(first.roomId).roundId,
        type: "ready",
      });
    const snapshot = service.snapshot(first.roomId);
    assert.equal(snapshot.phase, "countdown");
    assert.equal(snapshot.players.length, 12);
    const target = snapshot.players[0].target!;
    const elapsedMs =
      (((target.check.zoneStart + target.check.zoneSize / 2) % 360) / 360) *
      target.check.rotationMs;
    now = snapshot.startsAt! + elapsedMs;
    service.command(first.roomId, first.playerId, {
      id: randomUUID(),
      roundId: snapshot.roundId,
      type: "hit",
      checkId: target.id,
      elapsedMs,
    });
    const result = service.snapshot(first.roomId);
    assert.equal(result.phase, "running");
    assert.equal(result.players[0].points, 20);
    assert.ok(result.players.slice(1).every((player) => player.points === 0));
  } finally {
    service.onModuleDestroy();
  }
});
