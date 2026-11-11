import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { validateSync } from "class-validator";
import { SHOOTING_COOLDOWN_MS, type ShootingCommand } from "@qwiza/minigames";
import { ShootingService } from "../src/minigames/shooting.service";
import { parseShootingCommand, parseShootingCursor } from "../src/minigames/shooting.gateway";
import { JoinMinigameDto } from "../src/minigames/moment.dto";

class TestShootingService extends ShootingService {
  private seed = 123456;
  protected randomIndex = (upper: number) => {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed % upper;
  };
}

test("three authenticated seats share first-claim targets, deduplicate shots, stream cursors and restore until the server deadline", () => {
  const service = new TestShootingService();
  let now = 1000;
  service.now = () => now;
  try {
    const a = service.create("Аня", undefined),
      b = service.join(a.roomId, "Макс"),
      c = service.join(a.roomId, "Ника");
    const sessions = [a, b, c];
    assert.equal(service.authenticate(a.roomId, a.token), a.playerId);
    assert.throws(() => service.authenticate(a.roomId, b.token.slice(1)));
    for (const [index, session] of sessions.entries())
      service.connect(a.roomId, session.playerId, `socket-${index}`, true);
    const send = (
      playerId: string,
      type: ShootingCommand["type"],
      extra: Partial<ShootingCommand> = {},
    ) =>
      service.command(a.roomId, playerId, {
        id: randomUUID(),
        roundId: service.snapshot(a.roomId).roundId,
        type,
        ...extra,
      });
    for (const session of sessions) send(session.playerId, "ready");
    let snapshot = service.snapshot(a.roomId);
    assert.equal(snapshot.phase, "countdown");
    assert.throws(() => service.join(a.roomId, "Четвёртый"));
    now = snapshot.startsAt!;
    snapshot = service.snapshot(a.roomId);
    assert.equal(snapshot.phase, "running");
    assert.equal(snapshot.players.length, 3);
    assert.equal("nextSpawnAt" in snapshot, false);
    assert.equal("settings" in snapshot, false);
    const roundId = snapshot.roundId,
      endsAt = snapshot.endsAt!;
    const target = snapshot.targets.find((t) => t.kind === "gold")!;
    const hit: ShootingCommand = {
      id: randomUUID(),
      roundId,
      type: "shoot",
      targetId: target.id,
      x: target.x,
      y: target.y,
    };
    service.command(a.roomId, a.playerId, hit);
    service.command(a.roomId, a.playerId, hit);
    send(b.playerId, "shoot", { targetId: target.id, x: target.x, y: target.y });
    snapshot = service.snapshot(a.roomId);
    assert.deepEqual(
      snapshot.players.map((p) => p.points),
      [50, 0, 0],
    );
    assert.equal(snapshot.players[0].shots, 1);
    assert.equal(snapshot.players[1].shots, 1);
    assert.throws(() => send(a.playerId, "shoot", { x: 0.5, y: 0.5 }));
    now += SHOOTING_COOLDOWN_MS;
    const trap = service.snapshot(a.roomId).targets.find((t) => t.kind === "trap")!;
    send(c.playerId, "shoot", { targetId: trap.id, x: trap.x, y: trap.y });
    service.moveCursor(a.roomId, b.playerId, { seq: 2, x: 0.4, y: 0.6 });
    service.moveCursor(a.roomId, b.playerId, { seq: 1, x: 0.8, y: 0.2 });
    assert.equal(service.snapshot(a.roomId).players[1].cursor!.x, 0.4);
    service.connect(a.roomId, a.playerId, "restored", true);
    service.connect(a.roomId, a.playerId, "socket-0", false);
    assert.equal(service.snapshot(a.roomId).players[0].connected, true);
    service.connect(a.roomId, c.playerId, "socket-2", false);
    snapshot = service.snapshot(a.roomId);
    assert.equal(snapshot.phase, "running");
    assert.equal(snapshot.endsAt, endsAt);
    assert.equal(snapshot.roundId, roundId);
    assert.equal(snapshot.players[2].points, -30);
    assert.ok(!JSON.stringify(snapshot).includes(a.token));
    now = endsAt;
    snapshot = service.snapshot(a.roomId);
    assert.equal(snapshot.phase, "complete");
    assert.deepEqual(snapshot.winnerIds, [a.playerId]);
    assert.equal(snapshot.players[0].score, 1);
    assert.throws(() => send(a.playerId, "rematch"));
    service.connect(a.roomId, c.playerId, "returned", true);
    for (const session of sessions) send(session.playerId, "rematch");
    snapshot = service.snapshot(a.roomId);
    assert.equal(snapshot.phase, "countdown");
    assert.equal(snapshot.matchNumber, 2);
    assert.notEqual(snapshot.roundId, roundId);
    assert.deepEqual(
      snapshot.players.map((p) => p.points),
      [0, 0, 0],
    );
    assert.equal(snapshot.players[0].score, 1);
    assert.throws(() => service.command(a.roomId, a.playerId, { ...hit, id: randomUUID() }));
  } finally {
    service.onModuleDestroy();
  }
});

test("shooting transport rejects forged points, identity, timings, malformed targets and invalid cursor payloads", () => {
  const valid = {
    id: randomUUID(),
    roundId: randomUUID(),
    type: "shoot",
    targetId: randomUUID(),
    x: 0.5,
    y: 0.2,
  };
  assert.deepEqual(parseShootingCommand(valid), valid);
  const miss = { id: randomUUID(), roundId: valid.roundId, type: "shoot", x: 0.1, y: 0.8 };
  assert.deepEqual(parseShootingCommand(miss), miss);
  for (const invalid of [
    null,
    {},
    { ...valid, type: "hit" },
    { ...valid, type: "ready" },
    { ...valid, targetId: "bad" },
    { ...valid, targetId: null },
    { ...valid, x: NaN },
    { ...valid, y: -1 },
    { ...valid, x: 1.01 },
    { ...valid, points: 500 },
    { ...valid, playerId: "other" },
    { ...valid, elapsedMs: 0 },
    { ...valid, winnerIds: ["me"] },
  ])
    assert.throws(() => parseShootingCommand(invalid));
  assert.deepEqual(parseShootingCursor({ seq: 1, x: 0.2, y: 0.3 }), { seq: 1, x: 0.2, y: 0.3 });
  for (const invalid of [
    null,
    {},
    { seq: -1, x: 0.5, y: 0.5 },
    { seq: 1.1, x: 0.5, y: 0.5 },
    { seq: 1, x: Infinity, y: 0.5 },
    { seq: 1, x: 0.5, y: -1 },
    { seq: 1, x: 0.5, y: 0.5, points: 50 },
  ])
    assert.equal(parseShootingCursor(invalid), null);
});

test("dynamic lobby accepts six seats, clears readiness on join and blocks disconnected seats until reconnect", () => {
  const service = new TestShootingService();
  let now = 1000;
  service.now = () => now;
  try {
    const a = service.create("Аня", undefined);
    service.connect(a.roomId, a.playerId, "a", true);
    const ready = (playerId: string) =>
      service.command(a.roomId, playerId, {
        id: randomUUID(),
        roundId: service.snapshot(a.roomId).roundId,
        type: "ready",
      });
    assert.throws(() => ready(a.playerId));
    const b = service.join(a.roomId, "Макс");
    service.connect(a.roomId, b.playerId, "b", true);
    ready(a.playerId);
    assert.equal(service.snapshot(a.roomId).players[0].ready, true);
    const c = service.join(a.roomId, "Ника");
    assert.ok(service.snapshot(a.roomId).players.every((player) => !player.ready));
    assert.throws(() => ready(a.playerId));
    service.connect(a.roomId, c.playerId, "c", true);
    const others = ["Дима", "Оля", "Ира"].map((name) => service.join(a.roomId, name));
    assert.equal(service.snapshot(a.roomId).players.length, 6);
    for (const [index, session] of others.entries())
      service.connect(a.roomId, session.playerId, `other-${index}`, true);
    for (const session of [a, b, c, ...others]) ready(session.playerId);
    assert.equal(service.snapshot(a.roomId).phase, "countdown");
    service.connect(a.roomId, c.playerId, "c", false);
    assert.equal(service.snapshot(a.roomId).phase, "lobby");
    assert.ok(service.snapshot(a.roomId).players.every((player) => !player.ready));
    assert.throws(() => ready(a.playerId));
    service.connect(a.roomId, c.playerId, "c-returned", true);
    for (const session of [a, b, c, ...others]) ready(session.playerId);
    now = service.snapshot(a.roomId).startsAt!;
    assert.equal(service.snapshot(a.roomId).phase, "running");
    assert.throws(() => service.join(a.roomId, "Поздний"));
    const full = service.create("Первый", undefined);
    for (let index = 1; index < 12; index++) service.join(full.roomId, `Игрок ${index + 1}`);
    assert.equal(service.snapshot(full.roomId).players.length, 12);
    assert.throws(() => service.join(full.roomId, "Тринадцатый"));
  } finally {
    service.onModuleDestroy();
  }
});

test("creation requires only a name and rejects the removed playerCount parameter", () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };
  const valid = Object.assign(new JoinMinigameDto(), { displayName: "Аня" });
  assert.equal(validateSync(valid, options).length, 0);
  for (const playerCount of [2, 4, 6, "4", null]) {
    const dto = Object.assign(new JoinMinigameDto(), { displayName: "Аня", playerCount });
    assert.ok(validateSync(dto, options).some((error) => error.property === "playerCount"));
  }
});
