import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRockfallMatch,
  addRockfallPlayer,
  applyRockfallCommand,
  applyRockfallInput,
  advanceRockfall,
  rockfallPresenceChanged,
  rockfallPublicState,
  type RockfallCommand,
} from "../src/rockfall";
function fixture(count = 3) {
  const match = createRockfallMatch("lobby");
  let serial = 0;
  for (let i = 0; i < count; i++) {
    addRockfallPlayer(match, `p${i}`, `Игрок ${i}`);
    match.players[i].connected = true;
  }
  const send = (id: string, type: RockfallCommand["type"], now = 1000) =>
    applyRockfallCommand(
      match,
      id,
      { id: String(serial++), roundId: match.roundId, type },
      now,
      `round${serial}`,
      () => 0,
    );
  const start = () => {
    for (const p of match.players) send(p.id, "ready");
    advanceRockfall(match, 4000, () => 0);
  };
  const move = (id: string, dx: number, seq = 0, now = 4000, jumpSeq = 0) =>
    applyRockfallInput(match, id, { roundId: match.roundId, seq, dx, jumpSeq }, now, () => 0);
  return { match, start, send, move };
}
test("lobby supports twelve unique spawns, requires connected ready players and cancels countdown on disconnect", () => {
  const { match, send } = fixture(12);
  assert.equal(new Set(match.players.map((p) => p.x)).size, 12);
  assert.throws(() => addRockfallPlayer(match, "late", "Поздний"));
  for (const p of match.players) send(p.id, "ready");
  assert.equal(match.phase, "countdown");
  match.players[0].connected = false;
  rockfallPresenceChanged(match, 2000, () => 0);
  assert.equal(match.phase, "lobby");
  assert.ok(match.players.every((p) => !p.ready));
});
test("movement is bounded, expires after 250ms and rejects old rounds, stale sequences and invalid input", () => {
  const { match, start, move } = fixture();
  start();
  const x = match.players[0].x;
  move("p0", 1);
  advanceRockfall(match, 4600, () => 0);
  assert.ok(Math.abs(match.players[0].x - x - 0.9) < 1e-8);
  const stopped = match.players[0].x;
  advanceRockfall(match, 4700, () => 0);
  assert.equal(match.players[0].x, stopped);
  assert.equal(move("p0", -1, 0, 4700), false);
  assert.equal(move("p0", Infinity, 1, 4700), false);
  assert.equal(
    applyRockfallInput(match, "p0", { roundId: "old", seq: 9, dx: 1, jumpSeq: 1 }, 4700, () => 0),
    false,
  );
});
test("grounded players push instead of crossing through each other, with the same bounded recoil as falling floor", () => {
  const { match, start, move } = fixture(2);
  start();
  Object.assign(match.players[0], { x: 2 });
  Object.assign(match.players[1], { x: 2.7 });
  for (let i = 0; i < 6; i++) {
    move("p0", 1, i, 4000 + i * 80);
    advanceRockfall(match, 4080 + i * 80, () => 0);
    assert.ok(match.players[1].x - match.players[0].x >= 0.639);
  }
  assert.ok(match.players[1].x > 3);
  assert.ok(Math.hypot(match.bumps.p1.dx, match.bumps.p1.dy) <= 4.500001);
});
test("one jump clears an opponent, cannot be boosted in midair and does not auto-repeat when its packet is repeated", () => {
  const { match, start, move } = fixture(2);
  start();
  match.players[0].x = 2;
  match.players[1].x = 2.7;
  for (let i = 0; i < 7; i++) {
    move("p0", 1, i, 4000 + i * 80, 1);
    advanceRockfall(match, 4080 + i * 80, () => 0);
  }
  assert.ok(match.players[0].y > 1.02);
  assert.ok(match.players[0].x > match.players[1].x, "Jumping above the body permits passing");
  const vy = match.players[0].vy;
  move("p0", 0, 8, 4560, 2);
  assert.equal(match.players[0].vy, vy);
  advanceRockfall(match, 5100, () => 0);
  move("p0", 0, 9, 5100, 2);
  assert.equal(match.players[0].y, 0);
  assert.equal(match.players[0].vy, 0);
  move("p0", 0, 10, 5100, 3);
  assert.ok(match.players[0].vy > 0);
});
test("rocks hit airborne bodies too and clock catchup cannot skip a lethal fall", () => {
  const { match, start } = fixture(2);
  start();
  Object.assign(match.players[0], { x: 2, y: 1.3 });
  match.players[1].x = 5;
  match.rocks.push({ id: 1, x: 2, y: 2.5, radius: 0.3, vy: -6, dropsAt: 4000 });
  advanceRockfall(match, 100000, () => 0);
  assert.equal(match.phase, "complete");
  assert.equal(match.players[0].alive, false);
  assert.deepEqual(match.winnerIds, ["p1"]);
  assert.equal(match.players[1].score, 1);
  advanceRockfall(match, 200000, () => 0);
  assert.equal(match.players[1].score, 1);
});
test("simultaneous last hits are a draw; public state excludes controls and rematch resets momentum, jump and hazards", () => {
  const { match, start, send } = fixture(2);
  start();
  for (const [i, p] of match.players.entries()) {
    p.x = 2 + i * 3;
    match.rocks.push({ id: i, x: p.x, y: 1.1, radius: 0.3, vy: -4, dropsAt: 4000 });
  }
  advanceRockfall(match, 4020, () => 0);
  assert.deepEqual(match.winnerIds, []);
  assert.ok(match.players.every((p) => !p.alive && p.score === 0));
  const view = rockfallPublicState(match);
  assert.equal("inputs" in view, false);
  assert.equal("bumps" in view, false);
  view.players[0].x = 99;
  assert.notEqual(match.players[0].x, 99);
  for (const p of match.players) send(p.id, "rematch", 5000);
  assert.equal(match.phase, "countdown");
  assert.equal(match.rocks.length, 0);
  assert.deepEqual(match.bumps, {});
  assert.ok(match.players.every((p) => p.alive && p.y === 0 && p.jumpSeq === 0));
});
test("longer survival increases both rock count and frequency while keeping the active hazard set bounded", () => {
  const { match, start } = fixture(3);
  start();
  advanceRockfall(match, 14000, () => 0);
  const first = match.nextRockId;
  advanceRockfall(match, 64000, () => 0);
  const atMinute = match.nextRockId;
  advanceRockfall(match, 74000, () => 0);
  assert.ok(match.nextRockId - atMinute > first * 2);
  assert.ok(match.difficulty >= 5);
  assert.ok(match.rocks.length < 100);
});
