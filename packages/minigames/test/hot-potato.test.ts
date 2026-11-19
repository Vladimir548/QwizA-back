import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addHotPotatoPlayer,
  advanceHotPotato,
  applyHotPotatoCommand,
  applyHotPotatoInput,
  createHotPotato,
  HOT_POTATO_FUSE_MS,
  HOT_POTATO_MAX_PLAYERS,
  hotPotatoPublicState,
  onHotPotatoPresenceChanged,
} from "../src/hot-potato";
import {
  HOT_POTATO_DEPTH,
  HOT_POTATO_OBSTACLES,
  HOT_POTATO_PLAYER_RADIUS,
  HOT_POTATO_WIDTH,
  moveHotPotatoPlayer,
} from "../src/hot-potato-arena";

function createLobby(count: number) {
  const match = createHotPotato("lobby");
  for (let i = 0; i < count; i++) {
    const id = String(i);
    addHotPotatoPlayer(match, id, id);
    match.players[i].connected = true;
  }
  return match;
}
function start(count = 3) {
  const match = createLobby(count);
  for (const p of match.players) {
    applyHotPotatoCommand(match, p.id, { id: p.id, roundId: "lobby", type: "ready" }, 0, "round");
  }
  advanceHotPotato(match, match.startsAt!, () => 0);
  return match;
}

test("the lobby accepts six distinct players and needs at least two to start", () => {
  const solo = createLobby(1);
  assert.throws(() =>
    applyHotPotatoCommand(solo, "0", { id: "r", roundId: "lobby", type: "ready" }, 0, "round"),
  );
  const full = createLobby(HOT_POTATO_MAX_PLAYERS);
  assert.equal(full.players.length, 6);
  assert.throws(() => addHotPotatoPlayer(full, "extra", "extra"));
  assert.equal(start(6).phase, "running");
});

test("contact passes the existing fuse and requires separation before passing it back", () => {
  const match = start(2);
  const [a, b] = match.players;
  const startAt = match.startsAt!;
  const deadline = match.explodesAt;
  Object.assign(a, { x: 9, y: 3.6 });
  Object.assign(b, { x: 9.72, y: 3.6 });
  advanceHotPotato(match, startAt + 20);
  assert.equal(match.holderId, b.id);
  assert.equal(match.explodesAt, deadline);
  advanceHotPotato(match, startAt + 2020);
  assert.equal(match.holderId, b.id);
  b.x += 1;
  advanceHotPotato(match, startAt + 2040);
  b.x = a.x + 0.72;
  advanceHotPotato(match, startAt + 2060);
  assert.equal(match.holderId, a.id);
  assert.equal(match.explodesAt, deadline);
});

test("only the owner dies at ten seconds, the new fuse is fresh and the last survivor wins once", () => {
  const match = start(3);
  const firstDeadline = match.startsAt! + HOT_POTATO_FUSE_MS;
  advanceHotPotato(match, firstDeadline - 1);
  assert.equal(
    match.players.every((p) => p.alive),
    true,
  );
  advanceHotPotato(match, firstDeadline, (count) => count - 1);
  assert.equal(match.players[0].eliminatedAt, firstDeadline);
  assert.equal(match.lastExplosion!.playerId, "0");
  assert.equal(match.holderId, "2");
  assert.equal(match.explodesAt, firstDeadline + HOT_POTATO_FUSE_MS);
  assert.equal(
    applyHotPotatoInput(
      match,
      "0",
      { roundId: match.roundId, seq: 0, dx: 1, dy: 0 },
      firstDeadline,
    ),
    false,
  );
  advanceHotPotato(match, firstDeadline + HOT_POTATO_FUSE_MS * 4);
  assert.deepEqual(match.winnerIds, ["1"]);
  assert.equal(match.holderId, null);
  assert.equal(match.phase, "complete");
  assert.equal(match.players[1].score, 1);
  const snapshot = hotPotatoPublicState(match);
  for (const p of match.players)
    applyHotPotatoCommand(
      match,
      p.id,
      { id: p.id, roundId: "round", type: "rematch" },
      firstDeadline + HOT_POTATO_FUSE_MS * 4,
      "again",
    );
  assert.ok(snapshot.players[0].alive === false && match.players[0].alive);
  assert.equal(match.matchNumber, 2);
  assert.equal(match.players[1].score, 1);
  assert.equal(match.lastExplosion, null);
});

test("a countdown recovers after reconnect; stale, malformed and expired movement cannot move the player", () => {
  const match = createLobby(2);
  for (const p of match.players)
    applyHotPotatoCommand(match, p.id, { id: p.id, roundId: "lobby", type: "ready" }, 0, "r");
  const p = match.players[0];
  p.connected = false;
  onHotPotatoPresenceChanged(match, 500);
  advanceHotPotato(match, 5000);
  assert.equal(match.phase, "countdown");
  assert.equal(match.startsAt, null);
  p.connected = true;
  onHotPotatoPresenceChanged(match, 5000);
  advanceHotPotato(match, match.startsAt!);
  const now = match.startsAt!;
  const input = { roundId: "r", dx: 1, dy: 0, seq: 0 };
  assert.equal(applyHotPotatoInput(match, p.id, { ...input, roundId: "lobby" }, now), false);
  assert.equal(applyHotPotatoInput(match, p.id, { ...input, dx: Infinity }, now), false);
  assert.equal(applyHotPotatoInput(match, p.id, input, now), true);
  assert.equal(applyHotPotatoInput(match, p.id, input, now), false);
  const startX = p.x;
  advanceHotPotato(match, now + 500);
  assert.ok(p.x > startX && p.x < startX + 1.2);
  const stopX = p.x;
  advanceHotPotato(match, now + 800);
  assert.equal(p.x, stopX);
});

test("market props stop a runner and all six spawns are inside the arena and clear of cover", () => {
  const radius = HOT_POTATO_PLAYER_RADIUS;
  for (const p of createLobby(6).players) {
    const clone = { ...p };
    moveHotPotatoPlayer(clone, 0, 0);
    assert.equal(clone.x, p.x);
    assert.equal(clone.y, p.y);
  }
  for (const prop of HOT_POTATO_OBSTACLES) {
    const [a, b] = prop.points;
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (b.y - a.y) / length,
      ny = (a.x - b.x) / length;
    const player = { x: mx + nx * (radius + 0.2), y: my + ny * (radius + 0.2) };
    for (let i = 0; i < 60; i++) moveHotPotatoPlayer(player, -nx * 0.08, -ny * 0.08);
    assert.ok(Math.abs(Math.hypot(player.x - mx, player.y - my) - radius) < 0.00001, prop.kind);
  }
  const player = { x: HOT_POTATO_WIDTH / 2, y: HOT_POTATO_DEPTH / 2 };
  moveHotPotatoPlayer(player, 50, -50);
  assert.ok(Math.hypot((player.x - 10) / (10 - radius), (player.y - 6) / (6 - radius)) <= 1.00001);
});
