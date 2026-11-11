import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addBluffPlayer,
  advanceBluff,
  applyBluffCommand,
  bluffPublicState,
  bluffPresenceChanged,
  createBluffMatch,
  BLUFF_REVEAL_MS,
  type BluffCommand,
} from "../src/double-bluff";
function fixture() {
  const match = createBluffMatch("lobby");
  let serial = 0;
  for (const id of ["a", "b"]) {
    addBluffPlayer(match, id, id);
    match.players.at(-1)!.connected = true;
  }
  const send = (id: string, c: Omit<BluffCommand, "id" | "roundId">, now = 4000) =>
    applyBluffCommand(
      match,
      id,
      { ...c, id: String(serial++), roundId: match.roundId },
      now,
      `match${serial}`,
      () => 0,
    );
  const start = () => {
    send("a", { type: "ready" }, 1000);
    send("b", { type: "ready" }, 1000);
    advanceBluff(match, 4000);
  };
  const bid = (id: string, amount: number, now = 4000) =>
    send(id, { type: "bid", auction: match.auction, amount }, now);
  return { match, send, start, bid };
}
test("duel requires two connected ready players, gives fifteen tokens, and cancels a disconnected countdown", () => {
  const { match, send } = fixture();
  assert.throws(() => addBluffPlayer(match, "c", "c"));
  send("a", { type: "ready" }, 1000);
  assert.equal(match.phase, "lobby");
  send("b", { type: "ready" }, 1000);
  assert.equal(match.phase, "countdown");
  assert.deepEqual([...match.trophies].sort(), [2, 3, 4, 5, 6]);
  assert.ok(match.players.every((p) => p.tokens === 15));
  match.players[1].connected = false;
  bluffPresenceChanged(match);
  assert.equal(match.phase, "lobby");
  assert.equal(match.deadline, null);
});
test("an opponent and spectator cannot infer a sealed bid from the wallet, history or private payload", () => {
  const { match, start, bid } = fixture();
  start();
  const before = bluffPublicState(match, "b");
  bid("a", 9);
  const after = bluffPublicState(match, "b"),
    spectator = bluffPublicState(match);
  assert.equal(after.players[0].bid, null);
  assert.equal(spectator.players[0].bid, null);
  assert.equal(after.players[0].tokens, before.players[0].tokens);
  assert.equal(after.history.length, 0);
  assert.equal("bids" in after, false);
  assert.equal(bluffPublicState(match, "a").players[0].bid, 9);
  after.trophies[0] = 99;
  assert.notEqual(match.trophies[0], 99);
});
test("both pay their stakes on reveal, the higher bid wins the trophy, and accepted or stale bids cannot change it", () => {
  const { match, start, bid, send } = fixture();
  start();
  for (const amount of [-1, 16, 1.1, NaN]) assert.throws(() => bid("a", amount));
  bid("a", 4);
  assert.throws(() => bid("a", 5));
  bid("b", 3);
  assert.equal(match.phase, "revealing");
  assert.deepEqual(
    match.players.map((p) => p.tokens),
    [11, 12],
  );
  assert.equal(match.players[0].points, match.trophies[0]);
  assert.deepEqual(
    bluffPublicState(match).players.map((p) => p.bid),
    [4, 3],
  );
  advanceBluff(match, 4000 + BLUFF_REVEAL_MS);
  assert.equal(match.auction, 2);
  assert.throws(() => send("b", { type: "bid", auction: 1, amount: 0 }, 8000));
  assert.equal(bluffPublicState(match).players[0].bid, null);
});
test("equal bids burn the trophy, including two zeros; disconnected players time out with zero and spend no extra tokens", () => {
  const { match, start, bid } = fixture();
  start();
  bid("a", 3);
  bid("b", 3);
  assert.equal(match.history[0].winnerId, null);
  assert.ok(match.players.every((p) => p.points === 0 && p.tokens === 12));
  advanceBluff(match, 7200);
  bid("a", 2, 7200);
  match.players[1].connected = false;
  bluffPresenceChanged(match);
  advanceBluff(match, 37200);
  assert.deepEqual(
    match.history[1].bids.map((b) => b.amount),
    [2, 0],
  );
  assert.deepEqual(
    match.players.map((p) => p.tokens),
    [10, 12],
  );
});
test("the exact deadline rejects a late bid and clock catchup finishes five zero-bid rounds as a draw", () => {
  const { match, start, bid } = fixture();
  start();
  assert.throws(() => bid("a", 10, 34000));
  advanceBluff(match, 1000000);
  assert.equal(match.phase, "complete");
  assert.equal(match.history.length, 5);
  assert.deepEqual(match.result, { winnerId: null });
  assert.ok(match.players.every((p) => p.tokens === 15 && p.score === 0));
});
test("five trophies determine the winner once; mutual rematch preserves victories and resets budgets and private stakes", () => {
  const { match, start, bid, send } = fixture();
  start();
  let at = 4000;
  for (let round = 1; round <= 5; round++) {
    bid("a", 1, at);
    bid("b", 0, at);
    at += BLUFF_REVEAL_MS;
    advanceBluff(match, at);
  }
  assert.equal(match.phase, "complete");
  assert.equal(match.result?.winnerId, "a");
  assert.equal(match.players[0].points, 20);
  assert.equal(match.players[0].score, 1);
  advanceBluff(match, at + 1000);
  assert.equal(match.players[0].score, 1);
  const old = match.roundId;
  send("a", { type: "rematch" }, at);
  assert.equal(match.phase, "complete");
  send("b", { type: "rematch" }, at);
  assert.notEqual(match.roundId, old);
  assert.equal(match.phase, "countdown");
  assert.deepEqual(match.bids, {});
  assert.equal(match.history.length, 0);
  assert.ok(match.players.every((p) => p.tokens === 15 && p.points === 0));
  assert.equal(match.players[0].score, 1);
});
