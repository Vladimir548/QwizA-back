import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ZONE_GOAL,
  ZONE_ROTATION_MS,
  ZONE_PAUSE_MS,
  addZonePlayer,
  advanceZone,
  applyZoneCommand,
  createZoneMatch,
  randomZoneCheck,
  zoneAngle,
  zonePlayerAngle,
  zoneGrade,
  zonePublicState,
  type ZoneCheck,
} from "../src/zone";

function fixture() {
  const match = createZoneMatch("lobby");
  let serial = 0;
  const target = (previous?: ZoneCheck | null) => ({
    id: `check${++serial}`,
    check: randomZoneCheck(() => 0, previous),
  });
  for (const id of ["a", "b"]) {
    addZonePlayer(match, id, id);
    match.players.at(-1)!.connected = true;
  }
  for (const id of ["a", "b"])
    applyZoneCommand(
      match,
      id,
      { id, roundId: match.roundId, type: "ready" },
      1000,
      "match",
      target,
    );
  let now = match.startsAt!;
  function hit(playerId: string, grade: "perfect" | "hit" | "miss" = "perfect") {
    const player = match.players.find((p) => p.id === playerId)!;
    if (player.lastAttempt)
      now = Math.max(now, match.startsAt! + player.lastAttempt.elapsedMs + ZONE_PAUSE_MS);
    advanceZone(match, now);
    const check = player.target!.check;
    const angle =
      (check.zoneStart + (grade === "perfect" ? check.zoneSize / 2 : grade === "hit" ? 2 : 180)) %
      360;
    const withinTurn = (angle / 360) * check.rotationMs + player.pausedMs;
    const cycles = Math.max(
      0,
      Math.ceil((now - match.startsAt! + 1 - withinTurn) / check.rotationMs),
    );
    const elapsedMs = withinTurn + cycles * check.rotationMs;
    now = match.startsAt! + elapsedMs;
    applyZoneCommand(
      match,
      playerId,
      {
        id: `${playerId}${now}`,
        roundId: match.roundId,
        type: "hit",
        checkId: player.target!.id,
        elapsedMs,
      },
      now,
      "next",
      target,
    );
  }
  return { match, target, hit };
}
test("zone targets move after each press, keep the same fast speed and contain a smaller x2 zone", () => {
  const check = randomZoneCheck(() => 0),
    moved = randomZoneCheck(() => 0, check);
  assert.equal(check.rotationMs, 1400 / (1.3 * 1.2));
  assert.equal(check.zoneSize, 23.4);
  assert.equal(check.perfectSize, 6);
  assert.ok(check.perfectSize < check.zoneSize);
  assert.notEqual(moved.zoneStart, check.zoneStart);
  assert.equal(moved.rotationMs, ZONE_ROTATION_MS);
  assert.throws(() => randomZoneCheck(() => 360));
  assert.throws(() => randomZoneCheck(() => NaN));
});
test("needle keeps looping beyond the first turn; grading handles wrapped x2 sectors", () => {
  assert.equal(zoneAngle(ZONE_ROTATION_MS * 4.5, ZONE_ROTATION_MS), 180);
  const check = { zoneStart: 350, zoneSize: 40, perfectSize: 10, rotationMs: 1400 };
  assert.equal(zoneGrade(check, 10), "perfect");
  assert.equal(zoneGrade(check, 365), "perfect");
  assert.equal(zoneGrade(check, 350), "hit");
  assert.equal(zoneGrade(check, 30), "hit");
  assert.equal(zoneGrade(check, 349.9), "miss");
  assert.equal(zoneGrade(check, 30.1), "miss");
});
test("two ready connected seats share the initial countdown and no input means no timeout", () => {
  const match = createZoneMatch("lobby");
  addZonePlayer(match, "a", "A");
  match.players[0].connected = true;
  assert.throws(() =>
    applyZoneCommand(match, "a", { id: "1", roundId: "lobby", type: "ready" }, 0, "n", () => {
      throw new Error("Must not start");
    }),
  );
  const { match: ready } = fixture();
  assert.equal(ready.startsAt, 4000);
  advanceZone(ready, 3999);
  assert.equal(ready.phase, "countdown");
  advanceZone(ready, 100000);
  assert.equal(ready.phase, "running");
  assert.ok(ready.players.every((p) => p.points === 0 && p.attempts === 0));
  assert.throws(() => addZonePlayer(ready, "c", "C"));
});
test("perfect adds 20, hit adds 10, miss adds zero; every press pauses then replaces only that player's target", () => {
  const { match, hit } = fixture();
  const opponent = structuredClone(match.players[1]);
  let previous = match.players[0].target!.id;
  for (const [grade, points] of [
    ["perfect", 20],
    ["hit", 30],
    ["miss", 30],
  ] as const) {
    hit("a", grade);
    assert.equal(match.players[0].points, points);
    assert.equal(match.players[0].lastAttempt!.grade, grade);
    assert.equal(match.players[0].target!.id, previous);
    assert.notEqual(match.players[0].pendingTarget!.id, previous);
    advanceZone(match, match.players[0].resumeAt!);
    assert.notEqual(match.players[0].target!.id, previous);
    previous = match.players[0].target!.id;
    assert.deepEqual(match.players[1], opponent);
    assert.equal(match.phase, "running");
  }
  assert.equal(match.players[0].attempts, 3);
});
test("a press freezes exactly 500ms, rejects input during the pause and resumes from the same angle", () => {
  const { match, hit, target } = fixture();
  hit("a", "miss");
  const player = match.players[0],
    until = player.resumeAt!,
    attempt = player.lastAttempt!;
  const oldId = player.target!.id;
  assert.equal(until, match.startsAt! + attempt.elapsedMs + 500);
  assert.equal(player.pausedMs, 500);
  assert.equal(zonePlayerAngle(player, attempt.elapsedMs + 200), attempt.angle);
  assert.throws(() =>
    applyZoneCommand(
      match,
      "a",
      {
        id: "during-pause",
        roundId: match.roundId,
        type: "hit",
        checkId: oldId,
        elapsedMs: attempt.elapsedMs + 200,
      },
      until - 300,
      "n",
      target,
    ),
  );
  advanceZone(match, until - 1);
  assert.equal(player.target!.id, oldId);
  advanceZone(match, until);
  assert.notEqual(player.target!.id, oldId);
  assert.equal(player.resumeAt, null);
  assert.ok(Math.abs(zonePlayerAngle(player, attempt.elapsedMs + 500) - attempt.angle) < 0.0001);
  const expected = (attempt.angle + (100 / player.target!.check.rotationMs) * 360) % 360;
  assert.ok(Math.abs(zonePlayerAngle(player, attempt.elapsedMs + 600) - expected) < 0.0001);
  hit("a", "perfect");
  assert.equal(player.points, 20);
  assert.equal(player.pausedMs, 1000);
});
test("old targets, old matches and fabricated elapsed times cannot award progress", () => {
  const { match, target, hit } = fixture();
  const checkId = match.players[0].target!.id;
  hit("a");
  const now = match.startsAt! + 2000;
  for (const command of [
    { type: "hit" as const, checkId, elapsedMs: 2000 },
    { type: "hit" as const, checkId: match.players[0].target!.id, elapsedMs: NaN },
    { type: "hit" as const, checkId: match.players[0].target!.id, elapsedMs: -1 },
    { type: "hit" as const, checkId: match.players[0].target!.id, elapsedMs: 5000 },
  ])
    assert.throws(() =>
      applyZoneCommand(
        match,
        "a",
        { id: "x", roundId: match.roundId, ...command },
        now,
        "n",
        target,
      ),
    );
  assert.throws(() =>
    applyZoneCommand(
      match,
      "a",
      {
        id: "x",
        roundId: "old",
        type: "hit",
        checkId: match.players[0].target!.id,
        elapsedMs: 2000,
      },
      now,
      "n",
      target,
    ),
  );
  assert.equal(match.players[0].points, 20);
});
test("a racer continues independently while the opponent disconnects", () => {
  const { match, hit } = fixture();
  match.players[1].connected = false;
  hit("a");
  hit("a");
  assert.equal(match.players[0].points, 40);
  assert.equal(match.phase, "running");
  const view = zonePublicState(match);
  view.players[0].target!.check.zoneStart = 999;
  view.players[0].lastAttempt!.points = 999;
  assert.notEqual(match.players[0].target!.check.zoneStart, 999);
  assert.equal(match.players[0].lastAttempt!.points, 20);
});
test("first racer reaching 100 wins once, bars cap at 100 and later presses cannot tie the match", () => {
  const { match, hit } = fixture();
  match.players[0].points = 90;
  const winningTarget = match.players[0].target!.id;
  hit("a");
  assert.equal(match.players[0].points, ZONE_GOAL);
  assert.equal(match.winnerId, "a");
  assert.equal(match.players[0].target!.id, winningTarget);
  assert.equal(match.phase, "complete");
  assert.equal(match.players[0].score, 1);
  assert.ok(match.finishedAt !== null);
  assert.throws(() => hit("b"));
  advanceZone(match, 999999);
  assert.deepEqual(
    match.players.map((p) => p.score),
    [1, 0],
  );
});
test("mutual rematch resets progress and targets, preserves wins and starts a new continuous race", () => {
  const { match, hit, target } = fixture();
  for (let i = 0; i < 5; i++) hit("a");
  const ids = match.players.map((p) => p.target!.id);
  for (const playerId of ["a", "b"])
    applyZoneCommand(
      match,
      playerId,
      { id: playerId, roundId: match.roundId, type: "rematch" },
      100000,
      "rematch",
      target,
    );
  assert.equal(match.phase, "countdown");
  assert.equal(match.matchNumber, 2);
  assert.equal(match.roundId, "rematch");
  assert.equal(match.winnerId, null);
  assert.equal(match.finishedAt, null);
  assert.deepEqual(
    match.players.map((p) => p.points),
    [0, 0],
  );
  assert.deepEqual(
    match.players.map((p) => p.score),
    [1, 0],
  );
  assert.ok(
    match.players.every(
      (p, i) =>
        p.target!.id !== ids[i] &&
        p.lastAttempt === null &&
        p.attempts === 0 &&
        p.pausedMs === 0 &&
        p.resumeAt === null,
    ),
  );
});
