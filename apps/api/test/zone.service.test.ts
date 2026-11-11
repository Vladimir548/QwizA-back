import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ZoneService } from "../src/minigames/zone.service";
import { parseZoneCommand } from "../src/minigames/zone.gateway";

test("zone room deduplicates continuous inputs, restores progress, and never waits for the opponent", () => {
  const service = new ZoneService();
  let now = 1000;
  service.now = () => now;
  try {
    const a = service.create("Аня", undefined),
      b = service.join(a.roomId, "Ника");
    assert.equal(service.authenticate(a.roomId, a.token), a.playerId);
    assert.throws(() => service.authenticate(a.roomId, "wrong"));
    const full = service.create("Первый", undefined);
    for (let i = 1; i < 12; i++) service.join(full.roomId, `Игрок ${i}`);
    assert.throws(() => service.join(full.roomId, "Тринадцатый"));
    service.connect(a.roomId, a.playerId, "a", true);
    service.connect(a.roomId, b.playerId, "b", true);
    for (const playerId of [a.playerId, b.playerId])
      service.command(a.roomId, playerId, {
        id: randomUUID(),
        roundId: service.snapshot(a.roomId).roundId,
        type: "ready",
      });
    let state = service.snapshot(a.roomId);
    const start = state.startsAt!,
      roundId = state.roundId;
    const opponentTarget = state.players[1].target!;
    now = start + 1400 * 4;
    assert.equal(service.snapshot(a.roomId).phase, "running");
    for (let attempt = 0; attempt < 2; attempt++) {
      state = service.snapshot(a.roomId);
      const target = state.players[0].target!,
        center = (target.check.zoneStart + target.check.zoneSize / 2) % 360;
      const withinTurn = (center / 360) * target.check.rotationMs + state.players[0].pausedMs;
      const elapsedMs =
        withinTurn +
        Math.ceil((now - start + 1 - withinTurn) / target.check.rotationMs) *
          target.check.rotationMs;
      now = start + elapsedMs;
      const command = {
        id: randomUUID(),
        roundId,
        type: "hit" as const,
        checkId: target.id,
        elapsedMs,
      };
      service.command(a.roomId, a.playerId, command);
      service.command(a.roomId, a.playerId, command);
      assert.equal(service.snapshot(a.roomId).players[0].attempts, attempt + 1);
      assert.throws(() => service.command(a.roomId, a.playerId, { ...command, id: randomUUID() }));
      const paused = service.snapshot(a.roomId).players[0];
      assert.equal(paused.resumeAt, now + 500);
      assert.equal(paused.target!.id, target.id);
      service.connect(a.roomId, a.playerId, "restored", true);
      assert.equal(service.snapshot(a.roomId).players[0].resumeAt, paused.resumeAt);
      now = paused.resumeAt! - 1;
      assert.equal(service.snapshot(a.roomId).players[0].target!.id, target.id);
      now += 1;
      assert.notEqual(service.snapshot(a.roomId).players[0].target!.id, target.id);
    }
    assert.equal(service.snapshot(a.roomId).players[0].points, 40);
    assert.deepEqual(service.snapshot(a.roomId).players[1].target, opponentTarget);
    service.connect(a.roomId, a.playerId, "a2", true);
    service.connect(a.roomId, a.playerId, "a", false);
    assert.equal(service.snapshot(a.roomId).players[0].points, 40);
    service.connect(a.roomId, b.playerId, "b", false);
    now += 30000;
    assert.equal(service.snapshot(a.roomId).phase, "running");
    assert.equal(service.snapshot(a.roomId).roundId, roundId);
    assert.ok(!JSON.stringify(service.snapshot(a.roomId)).includes(a.token));
  } finally {
    service.onModuleDestroy();
  }
});
test("zone parser requires target identity and finite continuous timing, rejects forged progress", () => {
  const valid = {
    id: randomUUID(),
    roundId: randomUUID(),
    type: "hit",
    checkId: randomUUID(),
    elapsedMs: 20000,
  };
  assert.deepEqual(parseZoneCommand(valid), valid);
  for (const invalid of [
    null,
    {},
    { ...valid, checkId: undefined },
    { ...valid, checkId: "old" },
    { ...valid, points: 100 },
    { ...valid, playerId: "other" },
    { ...valid, elapsedMs: NaN },
    { ...valid, elapsedMs: -1 },
    { ...valid, type: "ready" },
  ])
    assert.throws(() => parseZoneCommand(invalid));
});
