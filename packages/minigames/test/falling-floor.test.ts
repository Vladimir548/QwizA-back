import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addFallingFloorPlayer,
  advanceFallingFloor,
  applyFallingFloorCommand,
  applyFallingFloorInput,
  createFallingFloorMatch,
  fallingFloorPresenceChanged,
  fallingFloorPublicState,
  FALLING_FLOOR_COUNTDOWN_MS,
  FALLING_FLOOR_GRACE_MS,
  FALLING_FLOOR_WARNING_MS,
  FALLING_FLOOR_SAFE_MS,
  FALLING_FLOOR_PLAYER_RADIUS,
  type FallingFloorCommand,
} from "../src/falling-floor";

const random = () => 0;
function fixture(count = 2) {
  const match = createFallingFloorMatch("lobby");
  for (let index = 0; index < count; index++) {
    addFallingFloorPlayer(match, `p${index}`, `Игрок ${index}`);
    match.players[index].connected = true;
  }
  let id = 0;
  const send = (playerId: string, type: FallingFloorCommand["type"], now = 1000) =>
    applyFallingFloorCommand(
      match,
      playerId,
      { id: String(id++), roundId: match.roundId, type },
      now,
      `round${id}`,
      random,
    );
  const ready = () => {
    for (const player of match.players) send(player.id, "ready");
  };
  const start = () => {
    ready();
    advanceFallingFloor(match, 4000, random);
  };
  const move = (playerId: string, dx: number, dy: number, seq = 0, now = 4000) =>
    applyFallingFloorInput(match, playerId, { roundId: match.roundId, seq, dx, dy }, now, random);
  return { match, send, ready, start, move };
}

test("dynamic lobby supports 2–12 connected players, resets readiness on join and cancels countdown presence loss", () => {
  const { match, send } = fixture(1);
  assert.throws(() => send("p0", "ready"));
  addFallingFloorPlayer(match, "p1", "Макс");
  assert.throws(() => send("p0", "ready"));
  match.players[1].connected = true;
  send("p0", "ready");
  addFallingFloorPlayer(match, "p2", "Ника");
  assert.ok(match.players.every((p) => !p.ready));
  for (let index = 3; index < 12; index++)
    addFallingFloorPlayer(match, `p${index}`, `Игрок ${index}`);
  assert.throws(() => addFallingFloorPlayer(match, "p12", "Тринадцатый"));
  assert.equal(new Set(match.players.map((p) => `${p.x},${p.y}`)).size, 12);
  for (const player of match.players) player.connected = true;
  for (const player of match.players) send(player.id, "ready");
  assert.equal(match.phase, "countdown");
  assert.equal(match.startsAt, 1000 + FALLING_FLOOR_COUNTDOWN_MS);
  assert.throws(() => addFallingFloorPlayer(match, "late", "Поздний"));
  assert.equal(
    applyFallingFloorInput(
      match,
      "p0",
      { roundId: match.roundId, seq: 0, dx: 1, dy: 0 },
      2000,
      random,
    ),
    false,
  );
  match.players[5].connected = false;
  fallingFloorPresenceChanged(match, 2500, random);
  assert.equal(match.phase, "lobby");
  assert.equal(match.startsAt, null);
  assert.ok(match.players.every((p) => !p.ready));
});

test("waves have initial grace, 2-second warning, permanent holes and 5-second safe intervals", () => {
  const { match, start } = fixture();
  start();
  assert.equal(match.nextWaveAt, 4000 + FALLING_FLOOR_GRACE_MS);
  advanceFallingFloor(match, 8999, random);
  assert.ok(match.tiles.every((tile) => tile.state === "safe"));
  advanceFallingFloor(match, 9000, random);
  const warning = match.tiles.filter((tile) => tile.state === "warning");
  assert.equal(warning.length, Math.ceil(64 * 0.18));
  assert.ok(warning.every((tile) => tile.fallsAt === 9000 + FALLING_FLOOR_WARNING_MS));
  assert.equal(match.nextWaveAt, null);
  advanceFallingFloor(match, 10999, random);
  assert.ok(warning.every((tile) => tile.state === "warning"));
  advanceFallingFloor(match, 11000, random);
  assert.ok(warning.every((tile) => tile.state === "gone"));
  assert.equal(match.nextWaveAt, 11000 + FALLING_FLOOR_SAFE_MS);
  advanceFallingFloor(match, 15999, random);
  assert.equal(match.tiles.filter((tile) => tile.state === "warning").length, 0);
  advanceFallingFloor(match, 16000, random);
  assert.equal(match.wave, 2);
  assert.ok(warning.every((tile) => tile.state === "gone"));
});

test("movement is authoritative, diagonal speed normalized, stale streams ignored and idle input expires at 250ms", () => {
  const { match, start, move } = fixture();
  start();
  const player = match.players[0];
  assert.equal(move("p0", 1, 1), true);
  advanceFallingFloor(match, 4100, random);
  assert.ok(Math.abs(Math.hypot(player.x - 2.5, player.y - 2.5) - 0.3) < 1e-8);
  assert.equal(move("p0", -1, 0, 0, 4100), false);
  assert.equal(move("p0", 2, 0, 1, 4100), false);
  assert.equal(move("p0", NaN, 0, 1, 4100), false);
  assert.equal(move("p0", 0, 0, -1, 4100), false);
  assert.equal(
    applyFallingFloorInput(match, "p0", { roundId: "old", seq: 1, dx: -1, dy: 0 }, 4100, random),
    false,
  );
  advanceFallingFloor(match, 5000, random);
  assert.ok(Math.abs(Math.hypot(player.x - 2.5, player.y - 2.5) - 0.75) < 1e-8);
  const stopped = { x: player.x, y: player.y };
  advanceFallingFloor(match, 6000, random);
  assert.deepEqual({ x: player.x, y: player.y }, stopped);
  assert.equal(move("p0", -1, 0, 1, 6000), true);
  assert.equal(player.inputSeq, 1);
});

test("board edges clamp player centers and disconnected input stops while idle seats stay vulnerable", () => {
  const { match, start, move } = fixture();
  start();
  const player = match.players[0];
  player.x = 7.7;
  move("p0", 1, 0);
  advanceFallingFloor(match, 4100, random);
  assert.equal(player.x, 8 - FALLING_FLOOR_PLAYER_RADIUS);
  player.connected = false;
  fallingFloorPresenceChanged(match, 4100, random);
  const x = player.x;
  advanceFallingFloor(match, 4400, random);
  assert.equal(player.x, x);
  assert.equal(move("p0", -1, 0, 1, 4400), false);
  player.x = 0.5;
  player.y = 0.5;
  advanceFallingFloor(match, 11000, random);
  assert.equal(player.alive, false);
  assert.equal(player.eliminatedAt, 11000);
  assert.deepEqual(match.winnerIds, ["p1"]);
});

test("clock catchup cannot tunnel through missing tiles and resolves the earliest fall before a later fall", () => {
  const { match, start, move } = fixture();
  start();
  match.tiles[19].state = "gone";
  match.players[0].x = 2.99;
  match.players[1].x = 2.98;
  match.players[1].y = 2.5;
  move("p0", 1, 0);
  move("p1", 1, 0);
  advanceFallingFloor(match, 100000, random);
  assert.equal(match.phase, "complete");
  assert.ok(Math.abs(match.endedAt! - (4000 + 10 / 3)) < 1e-7);
  assert.deepEqual(match.winnerIds, ["p1"]);
  assert.equal(match.players[0].alive, false);
  assert.equal(match.players[1].alive, true);
});

test("swept path catches a short corner crossing even when both fixed-step endpoints are safe", () => {
  const { match, start, move } = fixture();
  start();
  match.players[0].x = 2.99;
  match.players[0].y = 2.97;
  match.tiles[19].state = "gone";
  move("p0", 1, 1);
  advanceFallingFloor(match, 4020, random);
  assert.equal(match.players[0].alive, false);
  assert.equal(match.phase, "complete");
  assert.ok(match.endedAt! > 4000 && match.endedAt! < 4020);
});

test("simultaneous movement falls and simultaneous collapsing tiles are draws without score", () => {
  const moving = fixture();
  moving.start();
  for (const [index, player] of moving.match.players.entries()) {
    player.x = 2.5;
    player.y = 2.5 + index * 2;
    moving.move(player.id, 1, 0);
  }
  moving.match.tiles[19].state = "gone";
  moving.match.tiles[35].state = "gone";
  advanceFallingFloor(moving.match, 4500, random);
  assert.equal(moving.match.phase, "complete");
  assert.deepEqual(moving.match.winnerIds, []);
  assert.equal(moving.match.players[0].eliminatedAt, moving.match.players[1].eliminatedAt);
  assert.ok(moving.match.players.every((player) => player.score === 0));
  const dropping = fixture();
  dropping.start();
  for (const player of dropping.match.players) {
    player.x = 0.5;
    player.y = 0.5;
  }
  advanceFallingFloor(dropping.match, 20000, random);
  assert.equal(dropping.match.endedAt, 11000);
  assert.deepEqual(dropping.match.winnerIds, []);
  assert.ok(dropping.match.players.every((player) => player.eliminatedAt === 11000));
});

test("movement falls exactly at a collapse boundary resolve together before awarding a win", () => {
  const { match, start, move } = fixture();
  start();
  advanceFallingFloor(match, 9000, random);
  match.tiles[19].state = "gone";
  match.players[0].x = 2.94;
  match.players[0].y = 2.5;
  match.players[1].x = 0.5;
  match.players[1].y = 0.5;
  move("p0", 1, 0, 0, 10980);
  advanceFallingFloor(match, 11000, random);
  assert.equal(match.phase, "complete");
  assert.deepEqual(match.winnerIds, []);
  assert.ok(match.players.every((player) => player.eliminatedAt === 11000));
});

test("waves preserve a safe tile until the final wave and finish a stationary game in under 120 seconds", () => {
  const { match, start } = fixture();
  start();
  for (const player of match.players) {
    player.x = 7.5;
    player.y = 7.5;
  }
  let at = 9000;
  let sawLastSafe = false;
  while (match.phase === "running") {
    advanceFallingFloor(match, at, random);
    const safe = match.tiles.filter((tile) => tile.state === "safe").length;
    const warning = match.tiles.filter((tile) => tile.state === "warning").length;
    if (warning && safe === 0) {
      assert.equal(warning, 1);
      sawLastSafe = true;
    } else if (warning) assert.ok(safe >= 1);
    at += warning ? 2000 : 5000;
  }
  assert.equal(sawLastSafe, true);
  assert.equal(match.wave, 16);
  assert.ok(match.endedAt! - match.startsAt! < 120000);
  assert.deepEqual(match.winnerIds, []);
});

test("public snapshots isolate private inputs and rematch restores board/lives while preserving wins and changing round", () => {
  const { match, start, move, send } = fixture();
  start();
  move("p0", 1, 0);
  const view = fallingFloorPublicState(match);
  assert.equal("inputs" in view, false);
  assert.equal("simulatedAt" in view, false);
  assert.equal("knockbacks" in view, false);
  view.players[0].score = 99;
  view.tiles[0].state = "gone";
  view.winnerIds.push("p0");
  assert.equal(match.players[0].score, 0);
  assert.equal(match.tiles[0].state, "safe");
  assert.deepEqual(match.winnerIds, []);
  match.players[0].x = 0.5;
  match.players[0].y = 0.5;
  match.inputs = {};
  advanceFallingFloor(match, 11000, random);
  assert.equal(match.players[1].score, 1);
  assert.deepEqual(match.knockbacks, {});
  advanceFallingFloor(match, 100000, random);
  assert.equal(match.players[1].score, 1);
  match.players[0].connected = false;
  fallingFloorPresenceChanged(match, 100000, random);
  assert.throws(() => send("p1", "rematch", 100000));
  match.players[0].connected = true;
  const oldRound = match.roundId;
  send("p0", "rematch", 100000);
  assert.equal(match.phase, "complete");
  send("p1", "rematch", 100000);
  assert.equal(match.phase, "countdown");
  assert.equal(match.matchNumber, 2);
  assert.notEqual(match.roundId, oldRound);
  assert.ok(
    match.players.every(
      (player) => player.alive && player.inputSeq === -1 && player.eliminatedAt === null,
    ),
  );
  assert.ok(match.tiles.every((tile) => tile.state === "safe"));
  assert.equal(match.players[1].score, 1);
  assert.equal(
    applyFallingFloorInput(
      match,
      "p0",
      { roundId: oldRound, seq: 100, dx: 1, dy: 0 },
      103000,
      random,
    ),
    false,
  );
});

test("contact nudges a stationary opponent, gives recoil and smoothly loses momentum after release", () => {
  const { match, start, move } = fixture();
  start();
  const [a, b] = match.players;
  Object.assign(a, { x: 2.5, y: 4.5 });
  Object.assign(b, { x: 3.25, y: 4.5 });
  move(a.id, 1, 0);
  advanceFallingFloor(match, 4100, random);
  assert.ok(b.x > 3.3, "The other player must actually move without their own input");
  assert.ok(a.x < 2.8, "The moving player must feel the contact too");
  assert.ok(b.x - a.x >= 0.639);
  move(a.id, 0, 0, 1, 4100);
  const released = b.x;
  advanceFallingFloor(match, 4700, random);
  assert.ok(b.x > released);
  assert.ok(b.x - 3.25 < 0.65, "A light bump must not launch the opponent across the board");
  const settled = b.x;
  advanceFallingFloor(match, 4900, random);
  assert.ok(b.x - settled < 0.01);
});

test("a collision can knock an idle opponent into a hole and awards the survivor exactly once", () => {
  const { match, start, move, send } = fixture();
  start();
  const [a, b] = match.players;
  Object.assign(a, { x: 2.3, y: 2.5 });
  Object.assign(b, { x: 2.98, y: 2.5, connected: false });
  match.tiles[19].state = "gone";
  move(a.id, 1, 0);
  advanceFallingFloor(match, 4200, random);
  assert.equal(b.alive, false);
  assert.ok(b.eliminatedAt! > 4000 && b.eliminatedAt! < 4200);
  assert.equal(a.alive, true);
  assert.deepEqual(match.winnerIds, [a.id]);
  assert.equal(a.score, 1);
  assert.deepEqual(match.knockbacks, {});
  advanceFallingFloor(match, 5000, random);
  assert.equal(a.score, 1);
  b.connected = true;
  send(a.id, "rematch", 5000);
  send(b.id, "rematch", 5000);
  assert.deepEqual(match.knockbacks, {});
  assert.deepEqual(
    match.players.map((player) => [player.x, player.y]),
    [
      [2.5, 2.5],
      [5.5, 5.5],
    ],
  );
});

test("knockback uses swept hole detection even when its endpoint has crossed back onto solid ground", () => {
  const { match, start } = fixture();
  start();
  Object.assign(match.players[0], { x: 2.99, y: 2.97 });
  match.tiles[19].state = "gone";
  match.knockbacks.p0 = { dx: 3, dy: 3 };
  advanceFallingFloor(match, 4020, random);
  assert.equal(match.players[0].alive, false);
  assert.ok(match.players[0].eliminatedAt! > 4000 && match.players[0].eliminatedAt! < 4020);
});

test("group contacts are bounded, finite and independent of participant array ordering", () => {
  const run = (reverse: boolean) => {
    const { match, start, move } = fixture(3);
    start();
    for (const [index, player] of match.players.entries())
      Object.assign(player, { x: 2 + index * 0.65, y: 4.5 });
    if (reverse) match.players.reverse();
    move("p0", 1, 0);
    advanceFallingFloor(match, 4200, random);
    for (const player of match.players) {
      assert.ok(Number.isFinite(player.x) && Number.isFinite(player.y));
      const bump = match.knockbacks[player.id];
      assert.ok(Math.hypot(bump.dx, bump.dy) <= 4.500001);
    }
    return match.players.sort((a, b) => a.id.localeCompare(b.id)).map(({ x, y }) => [x, y]);
  };
  assert.deepEqual(run(false), run(true));
});
