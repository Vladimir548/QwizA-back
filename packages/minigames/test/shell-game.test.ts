import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createShellMatch,
  addShellPlayer,
  advanceShell,
  applyShellCommand,
  shellPublicState,
  shellSwapDuration,
  shellSwapCount,
  SHELL_CHOOSE_MS,
  SHELL_HIDE_MS,
  type ShellCommand,
} from "../src/shell-game";
function setup(
  count = 2,
  mode: "duel" | "group" = "duel",
  random: (upper: number) => number = () => 0,
) {
  let now = 1000,
    nonce = 0;
  const next = () => `round-${++nonce}`,
    match = createShellMatch("lobby", mode);
  for (let i = 0; i < count; i++) {
    addShellPlayer(match, String(i), String(i));
    match.players[i].connected = true;
  }
  const send = (id: string, type: ShellCommand["type"], slot?: number, roundId = match.roundId) =>
    applyShellCommand(
      match,
      id,
      { id: next(), roundId, type, ...(slot === undefined ? {} : { slot }) },
      now,
      next(),
      random,
      next,
    );
  const advance = (at: number) => {
    now = at;
    advanceShell(match, now, random, next);
  };
  const start = () => {
    for (const p of match.players) send(p.id, "ready");
  };
  const choosing = () => {
    while (match.phase !== "choosing" && match.deadline !== null) advance(match.deadline);
    return now;
  };
  const nextPhase = () => advance(match.deadline!);
  const answer = () => match.order.indexOf(match.coinCup);
  return { match, send, advance, start, choosing, nextPhase, answer };
}
test("duel admits exactly two, group admits twelve, readiness waits for everyone and late joins are rejected", () => {
  const duel = setup();
  assert.throws(() => addShellPlayer(duel.match, "extra", "x"));
  duel.send("0", "ready");
  assert.equal(duel.match.phase, "lobby");
  duel.send("1", "ready");
  assert.equal(duel.match.phase, "showing");
  assert.throws(() => addShellPlayer(duel.match, "extra", "x"));
  const group = setup(12, "group");
  assert.throws(() => addShellPlayer(group.match, "extra", "x"));
  group.match.players[2].connected = false;
  assert.throws(() => group.send("0", "ready"));
  group.match.players[2].connected = true;
  group.start();
  assert.equal(group.match.players.length, 12);
  assert.equal(group.match.round, 1);
});
test("coin is shown, hidden under cups, then only the current swap is sent; order commits exactly at the swap deadline", () => {
  const { match, start, send, nextPhase } = setup();
  start();
  assert.equal(shellPublicState(match).coinSlot, 0);
  assert.equal("coinCup" in shellPublicState(match), false);
  assert.throws(() => send("0", "choose", 0));
  nextPhase();
  assert.equal(match.phase, "hiding");
  nextPhase();
  assert.equal(match.phase, "shuffling");
  const view = shellPublicState(match);
  assert.equal(view.coinSlot, null);
  assert.deepEqual(view.order, [0, 1, 2]);
  assert.equal("plan" in view, false);
  assert.deepEqual(view.swap, { from: 0, to: 1, startedAt: 3650, endsAt: 4153 });
  view.order[0] = 99;
  view.swap!.from = 99;
  assert.deepEqual(match.order, [0, 1, 2]);
  assert.equal(match.swap!.from, 0);
  nextPhase();
  assert.deepEqual(match.order, [1, 0, 2]);
  assert.equal(match.swapsDone, 1);
});
test("private immutable choices wait for all, reveal together, eliminate wrong players and award the last survivor exactly once", () => {
  const { match, start, choosing, send, nextPhase, answer, advance } = setup(3, "group");
  start();
  choosing();
  const slot = answer();
  send("0", "choose", slot);
  assert.equal(match.phase, "choosing");
  assert.equal(shellPublicState(match, "0").players[0].choice, slot);
  assert.equal(shellPublicState(match, "1").players[0].choice, null);
  assert.equal(shellPublicState(match).players[0].choice, null);
  assert.equal(match.players[0].correct, null);
  assert.throws(() => send("0", "choose", (slot + 1) % 3));
  send("1", "choose", (slot + 1) % 3);
  send("2", "choose", (slot + 2) % 3);
  assert.equal(match.phase, "revealing");
  assert.equal(shellPublicState(match).coinSlot, slot);
  assert.equal(match.players[0].score, 0);
  assert.deepEqual(
    match.players.map((p) => p.alive),
    [true, false, false],
  );
  nextPhase();
  assert.equal(match.phase, "complete");
  assert.equal(match.winnerId, "0");
  assert.equal(match.players[0].score, 1);
  advance(1000000);
  assert.equal(match.players[0].score, 1);
});
test("all correct continue at higher speed with more swaps; eliminated players cannot return", () => {
  const { match, start, choosing, send, nextPhase, answer } = setup(3, "group");
  start();
  choosing();
  send("0", "choose", answer());
  send("1", "choose", answer());
  send("2", "choose", (answer() + 1) % 3);
  const previous = match.roundId,
    duration = match.swapDuration,
    count = match.swapCount;
  nextPhase();
  assert.equal(match.round, 2);
  assert.notEqual(match.roundId, previous);
  assert.ok(match.swapDuration < duration);
  assert.ok(match.swapCount > count);
  assert.equal(match.players[0].choice, null);
  assert.equal(match.players[2].alive, false);
  choosing();
  assert.throws(() => send("2", "choose", answer()));
  assert.throws(() => send("0", "choose", answer(), previous));
  send("0", "choose", answer());
  send("1", "choose", answer());
  nextPhase();
  assert.equal(match.round, 3);
  assert.equal(match.players[2].points, 0);
  assert.equal(shellSwapDuration(100), 126);
  assert.equal(shellSwapCount(100), 18);
});

test("continuing rounds retain the coin's cup and final cup positions, with a ten-second choice deadline", () => {
  let allowRandom = true;
  const { match, start, choosing, send, nextPhase, answer, advance } = setup(2, "duel", () => {
    assert.ok(allowRandom, "The next round must not pick a new coin cup");
    return 0;
  });
  start();
  const coin = match.coinCup;
  for (let round = 1; round <= 2; round++) {
    choosing();
    send("0", "choose", answer());
    send("1", "choose", answer());
    const order = [...match.order],
      slot = answer();
    const revealEnd = match.deadline!;
    allowRandom = false;
    nextPhase();
    allowRandom = true;
    assert.equal(match.coinCup, coin);
    assert.deepEqual(match.order, order);
    assert.equal(shellPublicState(match).coinSlot, slot);
    assert.equal(match.phase, "hiding");
    assert.equal(match.deadline, revealEnd + SHELL_HIDE_MS);
  }
  assert.notDeepEqual(match.order, [0, 1, 2]);
  assert.equal(SHELL_CHOOSE_MS, 10000);
  assert.equal(shellSwapDuration(1), Math.round(720 / (1.3 * 1.1)));
  const choosingStart = choosing();
  const deadline = match.deadline!;
  assert.equal(deadline - choosingStart, 10000);
  // At the last millisecond everyone can still choose; the deadline reveals unanswered cups.
  advance(deadline - 1);
  assert.equal(match.phase, "choosing");
  advance(deadline);
  assert.equal(match.phase, "revealing");
});

test("swap count grows by one per round through round six and all swaps finish before choosing", () => {
  const { match, start, choosing, send, nextPhase, answer } = setup();
  start();
  for (const [index, expected] of [6, 7, 8, 9, 10, 11, 12].entries()) {
    assert.equal(match.round, index + 1);
    assert.equal(match.swapCount, expected);
    choosing();
    assert.equal(match.swapsDone, expected);
    send("0", "choose", answer());
    send("1", "choose", answer());
    nextPhase();
  }
});
for (const reason of ["wrong answers", "timeout"] as const)
  test(`a duel ends in a draw after ${reason} leave no correct answer`, () => {
    const { match, start, choosing, send, nextPhase, answer } = setup();
    start();
    choosing();
    const roundId = match.roundId;
    if (reason === "timeout") nextPhase();
    else {
      send("0", "choose", (answer() + 1) % 3);
      send("1", "choose", (answer() + 2) % 3);
    }
    assert.equal(match.phase, "revealing");
    assert.equal(match.allMissed, true);
    nextPhase();
    assert.equal(match.phase, "complete");
    assert.equal(match.deadline, null);
    assert.equal(match.roundId, roundId);
    assert.equal(match.winnerId, null);
    assert.ok(match.players.every((p) => p.alive && p.points === 0 && p.score === 0));
  });
test("timeout eliminates pending participants when someone chose correctly; disconnected players cannot submit", () => {
  const { match, start, choosing, send, nextPhase, answer } = setup();
  start();
  choosing();
  send("0", "choose", answer());
  match.players[1].connected = false;
  assert.throws(() => send("1", "choose", answer()));
  nextPhase();
  assert.deepEqual(
    match.players.map((p) => p.alive),
    [true, false],
  );
  nextPhase();
  assert.equal(match.winnerId, "0");
});
test("rematch requires mutual readiness, resets rounds and choices, preserves wins; malformed slots never count", () => {
  const { match, start, choosing, send, nextPhase, answer } = setup();
  start();
  choosing();
  for (const slot of [-1, 3, NaN, 0.5]) assert.throws(() => send("0", "choose", slot));
  assert.equal(match.players[0].chosen, false);
  send("0", "choose", answer());
  send("1", "choose", (answer() + 1) % 3);
  nextPhase();
  send("0", "rematch");
  assert.equal(match.phase, "complete");
  send("1", "rematch");
  assert.equal(match.phase, "showing");
  assert.equal(match.round, 1);
  assert.equal(match.matchNumber, 2);
  assert.ok(match.players.every((p) => p.alive && p.points === 0 && !p.chosen));
  assert.equal(match.players[0].score, 1);
});
