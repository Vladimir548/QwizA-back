import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MEMORY_REVEAL_MS,
  MEMORY_SYMBOLS,
  addMemoryPlayer,
  advanceMemory,
  applyMemoryCommand,
  createMemoryMatch,
  memoryDeck,
  memoryPublicState,
} from "../src";
import type { MemoryCommand, MemoryMatch } from "../src";

const deck = () => [...MEMORY_SYMBOLS, ...MEMORY_SYMBOLS];
function game() {
  const match = createMemoryMatch("lobby", deck());
  addMemoryPlayer(match, "a", "Аня");
  addMemoryPlayer(match, "b", "Борис");
  for (const player of match.players) player.connected = true;
  return match;
}
function command(
  match: MemoryMatch,
  playerId: string,
  type: MemoryCommand["type"],
  index?: number,
  now = 1000,
  turn = match.turn,
) {
  applyMemoryCommand(
    match,
    playerId,
    {
      id: `${playerId}-${now}-${index}`,
      roundId: match.roundId,
      type,
      ...(index === undefined ? {} : { index, turn }),
    },
    now,
    `next-${now}`,
    deck,
  );
}
function start(match: MemoryMatch) {
  command(match, "a", "ready");
  command(match, "b", "ready");
}

test("deck contains exactly eight shuffled pairs and never shares its mutable array", () => {
  const shuffled = memoryDeck(() => 0);
  assert.equal(shuffled.length, 16);
  for (const symbol of MEMORY_SYMBOLS)
    assert.equal(shuffled.filter((value) => value === symbol).length, 2);
  assert.notDeepEqual(shuffled, deck());
  assert.throws(() => memoryDeck(() => NaN));
  assert.throws(() => createMemoryMatch("x", ["star"]));
  const input = deck();
  const match = createMemoryMatch("x", input);
  input[0] = "leaf";
  assert.equal(match.deck[0], "star");
});

test("hidden symbols and private deck stay off the wire before and during play", () => {
  const match = game();
  assert.ok(memoryPublicState(match).cards.every((card) => card.symbol === null));
  start(match);
  command(match, "a", "flip", 0);
  const view = memoryPublicState(match);
  assert.equal("deck" in view, false);
  assert.equal(view.cards[0].symbol, "star");
  assert.ok(view.cards.slice(1).every((card) => card.symbol === null));
  view.players[0].pairs = 900;
  assert.equal(match.players[0].pairs, 0);
});

test("start requires two connected and ready players; seats cannot be stolen", () => {
  const match = game();
  assert.throws(() => addMemoryPlayer(match, "c", "Третий"));
  command(match, "a", "ready");
  assert.equal(match.phase, "lobby");
  match.players[1].connected = false;
  assert.throws(() => command(match, "b", "ready"));
  match.players[1].connected = true;
  command(match, "b", "ready");
  assert.equal(match.phase, "playing");
  assert.equal(match.turnPlayerId, "a");
});

test("opponent, invalid indices, duplicate card and a stale turn are rejected", () => {
  const match = game();
  start(match);
  assert.throws(() => command(match, "b", "flip", 0));
  for (const index of [-1, 16, NaN, 0.5]) assert.throws(() => command(match, "a", "flip", index));
  command(match, "a", "flip", 0);
  assert.throws(() => command(match, "a", "flip", 0));
  assert.throws(() => command(match, "a", "flip", 8, 1000, -1));
  assert.equal(match.opened.length, 1);
});

test("mismatch stays visible, locks all clicks, then closes in place and gives the opponent the turn", () => {
  const match = game();
  start(match);
  command(match, "a", "flip", 0);
  command(match, "a", "flip", 1);
  assert.equal(match.phase, "revealing");
  assert.deepEqual(
    memoryPublicState(match)
      .cards.slice(0, 2)
      .map((card) => card.symbol),
    ["star", "bolt"],
  );
  assert.throws(() => command(match, "a", "flip", 2));
  assert.throws(() => command(match, "b", "flip", 2));
  advanceMemory(match, 1000 + MEMORY_REVEAL_MS - 1);
  assert.equal(match.phase, "revealing");
  advanceMemory(match, 1000 + MEMORY_REVEAL_MS);
  assert.equal(match.turnPlayerId, "b");
  assert.equal(match.phase, "playing");
  assert.ok(memoryPublicState(match).cards.every((card) => card.symbol === null));
  assert.deepEqual(match.deck, deck());
  command(match, "b", "flip", 0, 3000);
  command(match, "b", "flip", 8, 3000);
  assert.equal(match.players[1].pairs, 1);
  assert.equal(match.turnPlayerId, "b");
  assert.equal(match.lastPairBy, "b");
  assert.equal(memoryPublicState(match).cards[0].matchedBy, "b");
  assert.throws(() => command(match, "b", "flip", 0, 3000));
});

test("all pairs complete the game once; mutual rematch preserves wins, hides cards and alternates the starter", () => {
  const match = game();
  start(match);
  for (let index = 0; index < 8; index++) {
    command(match, "a", "flip", index);
    command(match, "a", "flip", index + 8);
  }
  assert.equal(match.phase, "complete");
  assert.deepEqual(match.winnerIds, ["a"]);
  assert.equal(match.players[0].pairs, 8);
  assert.equal(match.players[0].score, 1);
  assert.throws(() => command(match, "a", "flip", 0));
  assert.equal(match.players[0].score, 1);
  const oldRound = match.roundId;
  command(match, "a", "rematch", undefined, 5000);
  assert.equal(match.phase, "complete");
  command(match, "b", "rematch", undefined, 5000);
  assert.notEqual(match.roundId, oldRound);
  assert.equal(match.matchNumber, 2);
  assert.equal(match.turnPlayerId, "b");
  assert.equal(match.players[0].score, 1);
  assert.ok(match.players.every((player) => player.pairs === 0 && !player.ready));
  assert.ok(
    memoryPublicState(match).cards.every((card) => card.symbol === null && card.matchedBy === null),
  );
  assert.throws(() =>
    applyMemoryCommand(
      match,
      "b",
      { id: "old", roundId: oldRound, type: "flip", index: 0, turn: 0 },
      5000,
      "x",
      deck,
    ),
  );
});

test("four pairs each give both participants a tied win", () => {
  const match = game();
  start(match);
  for (let index = 0; index < 4; index++) {
    command(match, "a", "flip", index);
    command(match, "a", "flip", index + 8);
  }
  command(match, "a", "flip", 4);
  command(match, "a", "flip", 5);
  advanceMemory(match, 3000);
  for (let index = 4; index < 8; index++) {
    command(match, "b", "flip", index, 3000);
    command(match, "b", "flip", index + 8, 3000);
  }
  assert.deepEqual(match.winnerIds, ["a", "b"]);
  assert.deepEqual(
    match.players.map((player) => player.score),
    [1, 1],
  );
});
