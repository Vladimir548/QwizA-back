import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addMomentPlayer,
  advanceMoment,
  applyMomentCommand,
  createMomentMatch,
  formatMomentTime,
  momentPublicState,
} from "../src";

function match() {
  const game = createMomentMatch({ targetMs: 7000, roundCount: 3 }, "round-0");
  addMomentPlayer(game, "a", "Аня");
  addMomentPlayer(game, "b", "Борис");
  for (const player of game.players) player.connected = true;
  return game;
}
function ready(game: ReturnType<typeof match>, now = 1000, targetMs = game.settings.targetMs) {
  for (const id of ["a", "b"])
    applyMomentCommand(
      game,
      id,
      { id: id + now, roundId: game.roundId, type: "ready" },
      now,
      `round-${now}`,
      targetMs,
    );
}

test("settings enforce bounded target, series length and twelve-seat capacity", () => {
  assert.throws(() => createMomentMatch({ targetMs: NaN, roundCount: 5 }, "r"));
  assert.throws(() => createMomentMatch({ targetMs: 2000, roundCount: 5 }, "r"));
  assert.throws(() => createMomentMatch({ targetMs: 11000, roundCount: 5 }, "r"));
  assert.throws(() => createMomentMatch({ targetMs: 3500, roundCount: 5 }, "r"));
  assert.throws(() => createMomentMatch({ targetMs: 7000, roundCount: 4 }, "r"));
  const full = match();
  for (let i = 2; i < 12; i++) addMomentPlayer(full, `p${i}`, `Игрок ${i}`);
  assert.throws(() => addMomentPlayer(full, "extra", "Тринадцатый"));
});

test("start needs both connected participants to explicitly ready", () => {
  const game = match();
  applyMomentCommand(game, "a", { id: "1", roundId: game.roundId, type: "ready" }, 1000, "next");
  assert.equal(game.phase, "lobby");
  game.players[1].connected = false;
  assert.throws(() => ready(game));
  game.players[1].connected = true;
  ready(game);
  assert.equal(game.startsAt, 4000);
  assert.equal(game.phase, "countdown");
});

test("false starts, stale rounds, forged times and repeated stops are rejected", () => {
  const game = match();
  ready(game);
  const stop = { id: "stop", roundId: game.roundId, type: "stop" as const, elapsedMs: 7000 };
  assert.throws(() => applyMomentCommand(game, "a", stop, 3999, "n"));
  assert.throws(() => applyMomentCommand(game, "a", { ...stop, roundId: "old" }, 11000, "n"));
  assert.throws(() => applyMomentCommand(game, "a", { ...stop, elapsedMs: 4000 }, 11000, "n"));
  assert.throws(() => applyMomentCommand(game, "a", { ...stop, elapsedMs: Infinity }, 11000, "n"));
  applyMomentCommand(game, "a", stop, 11000, "n");
  assert.throws(() => applyMomentCommand(game, "a", stop, 11001, "n"));
});

test("attempts stay private until both stop; server awards the closest result", () => {
  const game = match();
  ready(game);
  applyMomentCommand(
    game,
    "a",
    { id: "1", roundId: game.roundId, type: "stop", elapsedMs: 7038 },
    11050,
    "n",
  );
  const publicState = momentPublicState(game);
  assert.equal(publicState.result, null);
  assert.equal(publicState.history.length, 0);
  assert.equal("attempts" in publicState, false);
  applyMomentCommand(
    game,
    "b",
    { id: "2", roundId: game.roundId, type: "stop", elapsedMs: 6910 },
    11060,
    "n",
  );
  assert.equal(game.phase, "result");
  assert.deepEqual(game.history[0].winnerIds, ["a"]);
  assert.equal(game.history[0].attempts[0].errorMs, 38);
  assert.deepEqual(
    game.players.map((player) => player.score),
    [1, 0],
  );
});

test("equal millisecond errors share the round; next round clears attempts", () => {
  const game = match();
  ready(game);
  for (const [id, elapsedMs] of [
    ["a", 6950],
    ["b", 7050],
  ] as const)
    applyMomentCommand(
      game,
      id,
      { id, roundId: game.roundId, type: "stop", elapsedMs },
      11060,
      "n",
    );
  assert.deepEqual(game.history[0].winnerIds, ["a", "b"]);
  ready(game, 12000, 3000);
  assert.equal(game.round, 2);
  assert.equal(game.settings.targetMs, 3000);
  assert.equal(game.history[0].targetMs, 7000);
  assert.equal(game.endsAt! - game.startsAt!, 6000);
  assert.equal(game.attempts.length, 0);
  assert.ok(game.players.every((player) => !player.stopped && !player.ready));
});

test("deadline finishes absent attempts; a completed series supports mutual rematch", () => {
  const game = match();
  for (let round = 0; round < 3; round++) {
    const start = 1000 + round * 30000;
    ready(game, start);
    advanceMoment(game, game.endsAt!);
    assert.ok(
      game.history
        .at(-1)!
        .attempts.every(
          (attempt) =>
            attempt.elapsedMs === 10000 && attempt.errorMs === 3000 && attempt.autoStopped,
        ),
    );
    assert.deepEqual(game.history.at(-1)!.winnerIds, ["a", "b"]);
  }
  assert.equal(game.phase, "complete");
  const before = game.roundId;
  applyMomentCommand(
    game,
    "a",
    { id: "rematch-a", roundId: before, type: "rematch" },
    100000,
    "rev-a",
  );
  assert.equal(game.phase, "complete");
  applyMomentCommand(
    game,
    "b",
    { id: "rematch-b", roundId: before, type: "rematch" },
    100000,
    "rev-b",
  );
  assert.equal(game.round, 1);
  assert.equal(game.phase, "countdown");
  assert.equal(game.history.length, 0);
  assert.notEqual(game.roundId, before);
  assert.ok(game.players.every((player) => player.score === 0));
});

test("missing opponent is stopped at target plus three seconds, even if the server advances late", () => {
  const game = match();
  ready(game);
  applyMomentCommand(
    game,
    "a",
    { id: "stop-a", roundId: game.roundId, type: "stop", elapsedMs: 7038 },
    11038,
    "n",
  );
  advanceMoment(game, game.endsAt! - 1);
  assert.equal(game.phase, "running");
  advanceMoment(game, game.endsAt! + 5000);
  assert.equal(game.phase, "result");
  assert.deepEqual(
    game.history[0].attempts.find((attempt) => attempt.playerId === "b"),
    { playerId: "b", elapsedMs: 10000, errorMs: 3000, autoStopped: true },
  );
  assert.deepEqual(game.history[0].winnerIds, ["a"]);
  advanceMoment(game, game.endsAt! + 10000);
  assert.equal(game.history.length, 1);
  assert.equal(game.players[0].score, 1);
});

test("an already expired manual stop cannot replace the automatic result", () => {
  const game = match();
  ready(game, 1000, 10000);
  assert.equal(game.endsAt! - game.startsAt!, 13000);
  assert.throws(() =>
    applyMomentCommand(
      game,
      "a",
      { id: "late", roundId: game.roundId, type: "stop", elapsedMs: 10000 },
      game.endsAt!,
      "n",
    ),
  );
  assert.ok(
    game.history[0].attempts.every((attempt) => attempt.elapsedMs === 13000 && attempt.autoStopped),
  );
});

test("format preserves millisecond precision in Russian notation", () => {
  assert.equal(formatMomentTime(7038), "7,038");
  assert.equal(formatMomentTime(0), "0,000");
});
