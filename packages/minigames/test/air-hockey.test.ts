import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addHockeyPlayer,
  advanceHockey,
  applyHockeyCommand,
  applyHockeyInput,
  createHockeyMatch,
  hockeyPublicState,
} from "../src/air-hockey";
import { HOCKEY, hockeyMallet, hockeyUnview, hockeyView, stepHockey } from "../src/hockey-physics";

function started() {
  const match = createHockeyMatch("round");
  for (const id of ["a", "b"]) {
    addHockeyPlayer(match, id, id);
    match.players.at(-1)!.connected = true;
  }
  for (const id of ["a", "b"])
    applyHockeyCommand(match, id, { id, roundId: "round", type: "ready" }, 1000, "next");
  advanceHockey(match, 4000);
  return match;
}
test("hockey waits for two connected ready players and a shared countdown", () => {
  const match = createHockeyMatch("round");
  addHockeyPlayer(match, "a", "A");
  match.players[0].connected = true;
  assert.throws(() =>
    applyHockeyCommand(match, "a", { id: "1", roundId: "round", type: "ready" }, 0, "n"),
  );
  addHockeyPlayer(match, "b", "B");
  match.players[1].connected = true;
  assert.throws(() => addHockeyPlayer(match, "c", "C"));
  applyHockeyCommand(match, "a", { id: "2", roundId: "round", type: "ready" }, 1000, "n");
  assert.equal(match.phase, "lobby");
  applyHockeyCommand(match, "b", { id: "3", roundId: "round", type: "ready" }, 1000, "n");
  advanceHockey(match, 3999);
  assert.equal(match.phase, "countdown");
  advanceHockey(match, 4000);
  assert.equal(match.phase, "playing");
});
test("movement stays on the owner's half, has a speed limit and rejects stale or nonfinite input", () => {
  const match = started();
  applyHockeyInput(match, "a", { roundId: "round", sequence: 2, x: 999, y: -900 });
  assert.deepEqual(match.mallets[0].target, { x: 464, y: 36 });
  const before = { ...match.mallets[0] };
  for (const input of [
    { roundId: "round", sequence: 1, x: 100, y: 100 },
    { roundId: "old", sequence: 3, x: 100, y: 100 },
    { roundId: "round", sequence: 4, x: NaN, y: 100 },
  ])
    applyHockeyInput(match, "a", input);
  assert.deepEqual(match.mallets[0].target, before.target);
  advanceHockey(match, 4000 + HOCKEY.stepMs + 0.01);
  assert.ok(
    Math.hypot(match.mallets[0].x - before.x, match.mallets[0].y - before.y) <=
      (HOCKEY.malletSpeed * HOCKEY.stepMs) / 1000 + 0.001,
  );
  assert.equal(match.mallets[1].x, 850);
});
test("puck bounces off boards and mallets, but only a full crossing inside the goal scores", () => {
  const mallets = [hockeyMallet(0), hockeyMallet(1)];
  const puck = { x: 400, y: 15, vx: 0, vy: -500 };
  assert.equal(stepHockey(puck, mallets), null);
  assert.ok(puck.vy > 0);
  Object.assign(puck, { x: 15, y: 70, vx: -500, vy: 0 });
  assert.equal(stepHockey(puck, mallets), null);
  assert.ok(puck.vx > 0);
  Object.assign(puck, { x: 200, y: 280, vx: -600, vy: 0 });
  stepHockey(puck, mallets);
  assert.ok(puck.vx > 0);
  Object.assign(puck, { x: -12, y: 280, vx: -600, vy: 0 });
  assert.equal(stepHockey(puck, mallets), 1);
  Object.assign(puck, { x: 1012, y: 280, vx: 600, vy: 0 });
  assert.equal(stepHockey(puck, mallets), 0);
});
test("moving mallets transfer momentum with a bounded puck speed", () => {
  const mallets = [hockeyMallet(0), hockeyMallet(1)];
  mallets[0].target.x = 464;
  const puck = { x: 205, y: 280, vx: 0, vy: 0 };
  stepHockey(puck, mallets);
  assert.ok(puck.vx > 0);
  assert.ok(Math.hypot(puck.vx, puck.vy) <= HOCKEY.puckSpeed + 0.001);
});
test("disconnect freezes the rally and reconnect resumes through a countdown without losing scores", () => {
  const match = started();
  advanceHockey(match, 4100);
  match.players[1].connected = false;
  advanceHockey(match, 4200);
  const puck = { ...match.puck };
  advanceHockey(match, 100000);
  assert.equal(match.phase, "paused");
  assert.deepEqual(match.puck, puck);
  match.players[1].connected = true;
  advanceHockey(match, 100000);
  assert.equal(match.serveAt, 103000);
  advanceHockey(match, 102999);
  assert.deepEqual(match.puck, puck);
  advanceHockey(match, 103050);
  assert.equal(match.phase, "playing");
  assert.notEqual(match.puck.x, puck.x);
});
test("seven goals award one win; mutual rematch resets goals, preserves wins and rejects old rounds", () => {
  const match = started();
  let now = 4000;
  for (let goal = 0; goal < 7; goal++) {
    Object.assign(match.puck, { x: 1012, y: 280, vx: 600, vy: 0 });
    advanceHockey(match, (now += 20));
    assert.equal(match.players[0].goals, goal + 1);
    if (goal < 6) {
      now = match.serveAt!;
      advanceHockey(match, now);
    }
  }
  assert.equal(match.phase, "complete");
  assert.equal(match.winnerId, "a");
  assert.equal(match.players[0].score, 1);
  advanceHockey(match, now + 9999);
  assert.equal(match.players[0].score, 1);
  applyHockeyCommand(match, "a", { id: "1", roundId: "round", type: "rematch" }, now, "new");
  assert.equal(match.phase, "complete");
  applyHockeyCommand(match, "b", { id: "2", roundId: "round", type: "rematch" }, now, "new");
  assert.equal(match.phase, "countdown");
  assert.equal(match.roundId, "new");
  assert.deepEqual(
    match.players.map((p) => p.goals),
    [0, 0],
  );
  assert.equal(match.players[0].score, 1);
  assert.throws(() =>
    applyHockeyCommand(match, "a", { id: "3", roundId: "round", type: "ready" }, now, "n"),
  );
  const view = hockeyPublicState(match);
  assert.equal("target" in view.mallets[0], false);
});
test("desktop and phone coordinate transforms are reversible for both seats", () => {
  for (const side of [0, 1])
    for (const portrait of [false, true]) {
      const point = { x: 123, y: 321 };
      assert.deepEqual(hockeyUnview(hockeyView(point, side, portrait), side, portrait), point);
    }
});
