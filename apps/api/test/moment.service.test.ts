import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MomentService } from "../src/minigames/moment.service";
import { parseMomentCommand } from "../src/minigames/moment.gateway";

test("room credentials, presence, idempotency, privacy and restore", () => {
  const service = new MomentService();
  let time = 1000;
  service.now = () => time;
  try {
    const first = service.create("Аня", { roundCount: 3 });
    const second = service.join(first.roomId, "Борис");
    const full = service.create("Первый", { roundCount: 3 });
    for (let i = 1; i < 12; i++) service.join(full.roomId, `Игрок ${i}`);
    assert.throws(() => service.join(full.roomId, "Тринадцатый"));
    assert.throws(() => service.authenticate(first.roomId, "bad"));
    assert.throws(() => service.authenticate(first.roomId, second.token + "1"));
    assert.equal(service.authenticate(first.roomId, first.token), first.playerId);
    service.connect(first.roomId, first.playerId, "a", true);
    service.connect(first.roomId, second.playerId, "b", true);
    const roundId = service.snapshot(first.roomId).roundId;
    const command = { id: randomUUID(), roundId, type: "ready" as const };
    service.command(first.roomId, first.playerId, command);
    service.command(first.roomId, second.playerId, { ...command, id: randomUUID() });
    const started = service.snapshot(first.roomId);
    service.command(first.roomId, first.playerId, command);
    assert.equal(service.snapshot(first.roomId).startsAt, started.startsAt);
    const elapsedMs = started.settings.targetMs + 38;
    time = started.startsAt! + elapsedMs;
    const stop = {
      id: randomUUID(),
      roundId: started.roundId,
      type: "stop" as const,
      elapsedMs,
    };
    service.command(first.roomId, first.playerId, stop);
    assert.equal(service.snapshot(first.roomId).result, null);
    assert.equal(service.snapshot(first.roomId, first.playerId).ownElapsedMs, elapsedMs);
    assert.equal(service.snapshot(first.roomId, second.playerId).ownElapsedMs, null);
    assert.ok(!JSON.stringify(service.snapshot(first.roomId)).includes(first.token));
    assert.equal(service.snapshot(first.roomId).history.length, 0);
    service.connect(first.roomId, first.playerId, "a", false);
    service.connect(first.roomId, first.playerId, "a2", true);
    assert.equal(service.snapshot(first.roomId).players[0].stopped, true);
    time += 42;
    service.command(first.roomId, second.playerId, {
      ...stop,
      id: randomUUID(),
      elapsedMs: elapsedMs + 42,
    });
    service.command(first.roomId, first.playerId, stop);
    assert.deepEqual(
      service.snapshot(first.roomId).players.map((player) => player.score),
      [1, 0],
    );
    assert.equal(service.snapshot(first.roomId).history.length, 1);
  } finally {
    service.onModuleDestroy();
  }
});

test("disconnect clears readiness but another tab keeps a seat connected", () => {
  const service = new MomentService();
  try {
    const first = service.create("Аня", { roundCount: 3 });
    const second = service.join(first.roomId, "Борис");
    service.connect(first.roomId, first.playerId, "a", true);
    service.connect(first.roomId, first.playerId, "a2", true);
    service.connect(first.roomId, second.playerId, "b", true);
    service.command(first.roomId, first.playerId, {
      id: randomUUID(),
      roundId: service.snapshot(first.roomId).roundId,
      type: "ready",
    });
    service.connect(first.roomId, first.playerId, "a", false);
    assert.equal(service.snapshot(first.roomId).players[0].connected, true);
    service.connect(first.roomId, second.playerId, "b", false);
    assert.ok(service.snapshot(first.roomId).players.every((player) => !player.ready));
  } finally {
    service.onModuleDestroy();
  }
});

test("server selects an integer target within 3–10 seconds for every round and archives it", () => {
  const service = new MomentService();
  let time = 1000;
  service.now = () => time;
  try {
    const first = service.create("Аня", { roundCount: 3 });
    const second = service.join(first.roomId, "Ника");
    service.connect(first.roomId, first.playerId, "a", true);
    service.connect(first.roomId, second.playerId, "b", true);
    for (let round = 1; round <= 3; round++) {
      const before = service.snapshot(first.roomId);
      for (const session of [first, second])
        service.command(first.roomId, session.playerId, {
          id: randomUUID(),
          roundId: before.roundId,
          type: "ready",
        });
      const running = service.snapshot(first.roomId);
      assert.ok(running.settings.targetMs >= 3000 && running.settings.targetMs <= 10000);
      assert.equal(running.settings.targetMs % 1000, 0);
      assert.equal(running.endsAt! - running.startsAt!, running.settings.targetMs + 3000);
      time = running.endsAt!;
      const result = service.snapshot(first.roomId);
      assert.equal(result.history.at(-1)!.targetMs, running.settings.targetMs);
      assert.ok(
        result.result!.attempts.every(
          (attempt) => attempt.elapsedMs === running.settings.targetMs + 3000,
        ),
      );
      assert.ok(result.players.every((player) => player.score === round));
    }
  } finally {
    service.onModuleDestroy();
  }
});

test("socket boundary rejects malformed messages and unknown fields", () => {
  const value = { id: randomUUID(), roundId: randomUUID(), type: "stop", elapsedMs: 7000 };
  assert.deepEqual(parseMomentCommand(value), value);
  for (const input of [
    null,
    [],
    {},
    { ...value, elapsedMs: NaN },
    { ...value, id: "x" },
    { ...value, playerId: "forged" },
    { ...value, type: "award" },
  ])
    assert.throws(() => parseMomentCommand(input));
});
