import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFirefightMatch,
  addFirefightPlayer,
  applyFirefightCommand,
  advanceFirefight,
  applyFirefightInput,
  firefightPresenceChanged,
  firefightPublicState,
  FIREFIGHT_RADIUS,
  FIREFIGHT_BODY_RADIUS,
  type FirefightInput,
} from "../src/firefight";
function setup(count = 2, mode: "duel" | "group" = "duel") {
  const match = createFirefightMatch("lobby", mode);
  let nonce = 0;
  for (let i = 0; i < count; i++) {
    addFirefightPlayer(match, String(i), String(i));
    match.players[i].connected = true;
  }
  const command = (id: string, type: "ready" | "rematch", now = 1000) =>
    applyFirefightCommand(
      match,
      id,
      { id: String(++nonce), roundId: match.roundId, type },
      now,
      String(++nonce),
    );
  const sequences = new Map<string, number>();
  const input = (id: string, at: number, values: Partial<FirefightInput> = {}) => {
    const seq = (sequences.get(id) ?? 0) + 1;
    sequences.set(id, seq);
    return applyFirefightInput(
      match,
      id,
      {
        roundId: match.roundId,
        seq,
        dx: 0,
        dy: 0,
        aimX: id === "0" ? 1 : -1,
        aimY: 0,
        fire: false,
        ...values,
      },
      at,
    );
  };
  const start = () => {
    for (const p of match.players) command(p.id, "ready");
    advanceFirefight(match, 4000);
  };
  return { match, command, input, start };
}
test("duels enforce two seats, group accepts twelve; all players must be ready and spawns do not overlap", () => {
  const duel = setup();
  assert.throws(() => addFirefightPlayer(duel.match, "extra", "x"));
  const group = setup(12, "group");
  assert.throws(() => addFirefightPlayer(group.match, "13", "x"));
  group.command("0", "ready");
  assert.equal(group.match.phase, "lobby");
  for (const p of group.match.players.slice(1)) group.command(p.id, "ready");
  assert.equal(group.match.phase, "countdown");
  advanceFirefight(group.match, 4000);
  for (const p of group.match.players)
    for (const q of group.match.players)
      if (p !== q) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > 2 * FIREFIGHT_BODY_RADIUS);
  assert.equal(group.match.phase, "running");
  assert.ok(group.match.players.every((p) => p.hp === 10));
});
test("diagonal movement is normalized, stale inputs expire, and boundary never eliminates players", () => {
  const { match, input, start } = setup();
  start();
  const p = match.players[0],
    x = p.x,
    y = p.y;
  assert.ok(input("0", 4000, { dx: 1, dy: 1 }));
  advanceFirefight(match, 4200);
  assert.ok(Math.abs(Math.hypot(p.x - x, p.y - y) - 3.1 * 0.2) < 0.001);
  advanceFirefight(match, 6000);
  const end = { x: p.x, y: p.y };
  advanceFirefight(match, 6500);
  assert.deepEqual({ x: p.x, y: p.y }, end);
  for (let at = 6500; at < 9500; at += 100) input("0", at, { dx: -1 });
  advanceFirefight(match, 9600);
  assert.ok(Math.hypot(p.x - 4, p.y - 4) <= FIREFIGHT_RADIUS - FIREFIGHT_BODY_RADIUS + 1e-8);
  assert.equal(p.hp, 10);
  assert.equal(p.alive, true);
  assert.equal(input("0", 9600, { seq: 0 }), false);
  assert.equal(input("0", 9600, { roundId: "old" }), false);
});
test("a projectile takes time, damages exactly one HP, and cannot shoot faster than 500 ms", () => {
  const { match, input, start } = setup();
  start();
  input("0", 4000, { fire: true });
  assert.equal(match.players[1].hp, 10);
  assert.equal(match.bullets.length, 1);
  for (let at = 4010; at <= 4490; at += 10) input("0", at, { fire: true });
  assert.equal(match.nextBullet, 1);
  assert.equal(match.players[1].hp, 10);
  input("0", 4500, { fire: true });
  assert.equal(match.nextBullet, 2);
  advanceFirefight(match, 4600);
  assert.equal(match.players[1].hp, 9);
  assert.equal(match.players[0].hp, 10);
  assert.equal(match.players[1].lastHitAt !== null, true);
});
test("sideways evasion misses a straight shot, while a swept shot hits only the first target", () => {
  const dodge = setup();
  dodge.start();
  dodge.input("0", 4000, { fire: true });
  for (let at = 4000; at < 4800; at += 100) dodge.input("1", at, { dy: 1 });
  advanceFirefight(dodge.match, 5000);
  assert.equal(dodge.match.players[1].hp, 10);
  const { match, start, input } = setup(3, "group");
  start();
  Object.assign(match.players[0], { x: 2, y: 4 });
  Object.assign(match.players[1], { x: 3, y: 4 });
  Object.assign(match.players[2], { x: 4, y: 4 });
  input("0", 4000, { fire: true });
  advanceFirefight(match, 4200);
  assert.equal(match.players[1].hp, 9);
  assert.equal(match.players[2].hp, 10);
});
test("holding fire stops after input expiry or disconnection; countdown pauses and reconnect preserves HP", () => {
  const { match, input, start } = setup();
  start();
  input("0", 4000, { fire: true });
  advanceFirefight(match, 4600);
  assert.equal(match.nextBullet, 1);
  assert.equal(match.players[1].hp, 9);
  input("0", 4700, { fire: true });
  match.players[0].connected = false;
  firefightPresenceChanged(match, 4710);
  advanceFirefight(match, 6000);
  assert.equal(match.nextBullet, 2);
  assert.equal(input("0", 6000, { fire: true }), false);
  match.players[0].connected = true;
  firefightPresenceChanged(match, 6100);
  assert.equal(match.players[1].hp, 8);
  const paused = setup();
  for (const p of paused.match.players) paused.command(p.id, "ready");
  paused.match.players[0].connected = false;
  firefightPresenceChanged(paused.match, 2000);
  advanceFirefight(paused.match, 10000);
  assert.equal(paused.match.phase, "countdown");
  paused.match.players[0].connected = true;
  firefightPresenceChanged(paused.match, 10000);
  advanceFirefight(paused.match, 12000);
  assert.equal(paused.match.phase, "running");
});
test("ten hits finish once; group continues after an elimination, blocks dead controls, rematch resets HP and preserves victories", () => {
  const { match, input, start, command } = setup(3, "group");
  start();
  Object.assign(match.players[0], { x: 2, y: 4 });
  Object.assign(match.players[1], { x: 4, y: 4 });
  Object.assign(match.players[2], { x: 5, y: 5 });
  for (let at = 4000; at <= 9200; at += 100) input("0", at, { fire: true });
  assert.equal(match.players[1].hp, 0);
  assert.equal(match.phase, "running");
  assert.equal(input("1", 9300, { fire: true }), false);
  const deadAt = match.players[1].eliminatedAt!;
  assert.ok(deadAt > 4000);
  const target = match.players[2],
    shooter = match.players[0],
    dx = target.x - shooter.x,
    dy = target.y - shooter.y,
    length = Math.hypot(dx, dy);
  for (let at = 9400; at <= 15000 && match.phase === "running"; at += 100)
    input("0", at, { fire: true, aimX: dx / length, aimY: dy / length });
  assert.equal(match.phase, "complete");
  assert.equal(match.winnerId, "0");
  assert.equal(shooter.score, 1);
  assert.ok(target.eliminatedAt! > deadAt);
  advanceFirefight(match, 20000);
  assert.equal(shooter.score, 1);
  const previous = match.roundId;
  for (const p of match.players) command(p.id, "rematch", 20000);
  assert.notEqual(match.roundId, previous);
  assert.equal(match.phase, "countdown");
  assert.ok(match.players.every((p) => p.hp === 10 && p.alive && p.lastShotAt === null));
  assert.equal(shooter.score, 1);
});
test("simultaneous final hits draw; public state is detached and rejects forged/non-finite input", () => {
  const { match, input, start } = setup();
  start();
  match.players[0].hp = match.players[1].hp = 1;
  input("0", 4000, { fire: true });
  input("1", 4000, { fire: true });
  advanceFirefight(match, 4700);
  assert.equal(match.phase, "complete");
  assert.equal(match.winnerId, null);
  assert.ok(match.players.every((p) => !p.alive && p.score === 0));
  const view = firefightPublicState(match);
  view.players[0].hp = 99;
  assert.equal(match.players[0].hp, 0);
  assert.equal("inputs" in view, false);
  const next = setup();
  next.start();
  for (const values of [{ aimX: 0, aimY: 0 }, { aimX: NaN }, { dx: 2 }, { seq: Infinity }])
    assert.equal(next.input("0", 4000, values), false);
});
