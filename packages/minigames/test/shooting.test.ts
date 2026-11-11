import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SHOOTING_COOLDOWN_MS,
  SHOOTING_ARENA_HEIGHT_RATIO,
  SHOOTING_COUNTDOWN_MS,
  SHOOTING_DURATION_MS,
  SHOOTING_MAX_PLAYERS,
  addShootingPlayer,
  advanceShooting,
  applyShootingCommand,
  applyShootingCursor,
  createShootingMatch,
  shootingPublicState,
  type ShootingCommand,
} from "../src/shooting";

function fixture(count = 3, initialSeed = 123456) {
  const match = createShootingMatch("lobby");
  let now = 1000,
    sequence = 0,
    seed = initialSeed;
  const random = (upper: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % upper;
  };
  const id = () => `id-${++sequence}`;
  for (let i = 0; i < count; i++) {
    addShootingPlayer(match, `p${i}`, `Игрок ${i}`);
    match.players[i].connected = true;
  }
  const tick = (at: number) => {
    now = at;
    advanceShooting(match, now, random, id);
  };
  const send = (
    playerId: string,
    type: ShootingCommand["type"],
    extra: Partial<ShootingCommand> = {},
  ) =>
    applyShootingCommand(
      match,
      playerId,
      { id: id(), roundId: match.roundId, type, ...extra },
      now,
      id(),
      random,
      id,
    );
  const ready = () => {
    for (const player of match.players) send(player.id, "ready");
  };
  const start = () => {
    ready();
    tick(match.startsAt!);
  };
  const shoot = (playerId: string, targetId?: string) =>
    send(playerId, "shoot", { targetId, x: 0.5, y: 0.5 });
  return { match, tick, send, ready, start, shoot };
}

test("shooting supports up to twelve players, resets readiness on joins and protects countdown", () => {
  const alone = fixture(1);
  assert.throws(() => alone.send("p0", "ready"));
  const pair = fixture(2);
  pair.start();
  assert.equal(pair.match.phase, "running");
  assert.equal(pair.match.players.length, 2);
  const full = fixture(SHOOTING_MAX_PLAYERS);
  assert.throws(() => addShootingPlayer(full.match, "extra", "Лишний"));
  const { match, send, tick, ready } = fixture(2);
  send("p0", "ready");
  assert.equal(match.players[0].ready, true);
  addShootingPlayer(match, "p2", "Третий");
  assert.ok(match.players.every((player) => !player.ready));
  match.players[2].connected = false;
  assert.throws(() => send("p0", "ready"));
  match.players[2].connected = true;
  ready();
  assert.equal(match.startsAt, 1000 + SHOOTING_COUNTDOWN_MS);
  assert.equal(match.endsAt, match.startsAt! + SHOOTING_DURATION_MS);
  assert.equal(match.phase, "countdown");
  assert.throws(() => send("p0", "shoot", { x: 0.5, y: 0.5 }));
  assert.throws(() => addShootingPlayer(match, "extra", "Лишний"));
  match.players[2].connected = false;
  tick(match.startsAt! - 1);
  assert.equal(match.phase, "lobby");
  assert.equal(match.startsAt, null);
  assert.ok(match.players.every((p) => !p.ready));
});

test("all six participants share one random field with varied, bounded nonoverlapping expiring targets", () => {
  const { match, start, tick } = fixture(6);
  start();
  assert.equal(match.phase, "running");
  assert.equal(match.targets.length, 7);
  assert.deepEqual(
    new Set(match.targets.map((t) => t.kind)),
    new Set(["normal", "bonus", "gold", "trap"]),
  );
  const ids = match.targets.map((t) => t.id);
  for (const target of match.targets) {
    assert.ok(target.x >= 0.09 && target.x <= 0.91);
    assert.ok(target.y * SHOOTING_ARENA_HEIGHT_RATIO - target.radius >= 0.01 - 1e-12);
    assert.ok((1 - target.y) * SHOOTING_ARENA_HEIGHT_RATIO - target.radius >= 0.03 - 1e-12);
    assert.ok(target.radius >= 0.04 && target.radius <= 0.065);
    assert.ok(target.expiresAt - target.spawnedAt >= 1800);
    assert.ok(target.expiresAt - target.spawnedAt <= 3500);
    for (const other of match.targets)
      if (target !== other)
        assert.ok(
          Math.hypot(target.x - other.x, (target.y - other.y) * SHOOTING_ARENA_HEIGHT_RATIO) >=
            Math.max(target.radius + other.radius + 0.025, 0.14),
        );
  }
  tick(match.startsAt! + 4000);
  assert.ok(match.targets.every((target) => !ids.includes(target.id)));
  assert.ok(match.targets.length <= 8);
  const view = shootingPublicState(match);
  assert.equal("nextSpawnAt" in view, false);
  assert.equal("settings" in view, false);
  view.players[0].points = 999;
  view.targets[0].points = 50;
  assert.equal(match.players[0].points, 0);
  assert.notEqual(view.targets[0], match.targets[0]);
});

test("random initial fields keep circles and their value labels inside a shallow arena across 500 seeds", () => {
  for (let seed = 1; seed <= 500; seed++) {
    const { match, start } = fixture(3, seed);
    start();
    assert.equal(match.targets.length, 7, `initial target count for seed ${seed}`);
    assert.deepEqual(
      new Set(match.targets.map((target) => target.kind)),
      new Set(["normal", "bonus", "gold", "trap"]),
    );
    for (const target of match.targets) {
      assert.ok(target.y * SHOOTING_ARENA_HEIGHT_RATIO - target.radius >= 0.01 - 1e-12);
      assert.ok((1 - target.y) * SHOOTING_ARENA_HEIGHT_RATIO - target.radius >= 0.03 - 1e-12);
      assert.ok(target.x - target.radius >= 0);
      assert.ok(target.x + target.radius <= 1);
      for (const other of match.targets) {
        if (target !== other)
          assert.ok(
            Math.hypot(target.x - other.x, (target.y - other.y) * SHOOTING_ARENA_HEIGHT_RATIO) >=
              Math.max(target.radius + other.radius + 0.025, 0.14),
          );
      }
    }
  }
});

test("first accepted shooter claims a target once, races become zero-point misses and traps cost 30", () => {
  const { match, start, shoot, tick } = fixture();
  start();
  const bonus = match.targets.find((t) => t.kind === "bonus")!;
  const trap = match.targets.find((t) => t.kind === "trap")!;
  shoot("p0", bonus.id);
  shoot("p1", bonus.id);
  assert.deepEqual(
    match.players.map((p) => p.points),
    [25, 0, 0],
  );
  assert.equal(match.players[0].hits, 1);
  assert.equal(match.players[1].shots, 1);
  assert.equal(match.effects[1].points, 0);
  assert.equal(match.effects[1].targetId, null);
  assert.throws(() => shoot("p0", trap.id));
  tick(match.startsAt! + SHOOTING_COOLDOWN_MS);
  shoot("p0", trap.id);
  assert.equal(match.players[0].points, -5);
  assert.equal(match.players[0].traps, 1);
  assert.equal(match.players[0].shots, 2);
  assert.ok(!match.targets.some((t) => t.id === trap.id));
});

test("expiry, missing targets, bounds, cooldown and stale rounds cannot fabricate points", () => {
  const { match, start, shoot, send, tick } = fixture();
  start();
  const expired = match.targets[0];
  tick(expired.expiresAt);
  shoot("p0", expired.id);
  assert.equal(match.players[0].points, 0);
  assert.equal(match.players[0].shots, 1);
  tick(expired.expiresAt + SHOOTING_COOLDOWN_MS - 1);
  assert.throws(() => shoot("p0"));
  tick(expired.expiresAt + SHOOTING_COOLDOWN_MS);
  shoot("p0");
  assert.equal(match.players[0].shots, 2);
  for (const x of [-1, Infinity, NaN, 1.01])
    assert.throws(() => send("p1", "shoot", { x, y: 0.5 }));
  assert.throws(() => send("p1", "shoot", { x: 0.5, y: 0.5, roundId: "old" }));
  assert.equal(match.players[1].shots, 0);
  tick(match.endsAt!);
  assert.equal(match.phase, "complete");
  assert.deepEqual(match.winnerIds, []);
  assert.throws(() => shoot("p1"));
});

test("cursor updates stay bounded and ordered without changing shots or points; public state is cloned", () => {
  const { match, start } = fixture();
  start();
  applyShootingCursor(match, "p0", { x: 0.2, y: 0.7, seq: 2 }, 5000);
  for (const input of [
    { x: 0.8, y: 0.2, seq: 1 },
    { x: NaN, y: 0.2, seq: 3 },
    { x: -1, y: 0.2, seq: 4 },
    { x: 0.8, y: 0.2, seq: 1.5 },
  ])
    applyShootingCursor(match, "p0", input, 6000);
  assert.deepEqual(match.players[0].cursor, { x: 0.2, y: 0.7, seq: 2, updatedAt: 5000 });
  const view = shootingPublicState(match);
  view.players[0].cursor!.x = 0;
  assert.equal(match.players[0].cursor!.x, 0.2);
  assert.equal(match.players[0].shots, 0);
  assert.equal(match.players[0].points, 0);
});

test("server finishes while players disconnect, ties award each leader once and rematch retains wins", () => {
  const { match, start, shoot, tick, send } = fixture();
  start();
  const normals = match.targets.filter((t) => t.kind === "normal");
  shoot("p0", normals[0].id);
  shoot("p1", normals[1].id);
  match.players[2].connected = false;
  tick(match.endsAt!);
  assert.equal(match.phase, "complete");
  assert.deepEqual(match.winnerIds, ["p0", "p1"]);
  assert.deepEqual(
    match.players.map((p) => p.score),
    [1, 1, 0],
  );
  tick(match.endsAt! + 1000);
  assert.deepEqual(
    match.players.map((p) => p.score),
    [1, 1, 0],
  );
  assert.throws(() => send("p0", "rematch"));
  match.players[2].connected = true;
  const old = match.roundId;
  for (const player of match.players) send(player.id, "rematch");
  assert.equal(match.phase, "countdown");
  assert.equal(match.matchNumber, 2);
  assert.notEqual(match.roundId, old);
  assert.ok(match.players.every((p) => p.points === 0 && p.shots === 0 && p.cursor === null));
  assert.deepEqual(
    match.players.map((p) => p.score),
    [1, 1, 0],
  );
  assert.throws(() => send("p0", "shoot", { x: 0.5, y: 0.5, roundId: old }));
});
