import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TWENTY_ONE_FLIGHT_MS,
  TWENTY_ONE_FLIP_MS,
  addTwentyOnePlayer,
  advanceTwentyOne,
  applyTwentyOneCommand,
  createTwentyOneMatch,
  twentyOneDeck,
  twentyOnePublicState,
  twentyOneTotal,
  twentyOneValue,
  type TwentyOneFace,
  type TwentyOneCommand,
} from "../src/twenty-one";

function ordered(prefix: TwentyOneFace[]) {
  const deck = twentyOneDeck((upper) => upper - 1);
  const used = new Set(prefix.map((c) => `${c.rank}:${c.suit}`));
  return [...prefix, ...deck.filter((c) => !used.has(`${c.rank}:${c.suit}`))];
}
const face = (rank: TwentyOneFace["rank"], suit: TwentyOneFace["suit"]): TwentyOneFace => ({
  rank,
  suit,
});
const initial = [
  face("10", "spades"),
  face("9", "hearts"),
  face("K", "clubs"),
  face("6", "diamonds"),
];
function fixture(prefix = initial) {
  const match = createTwentyOneMatch("lobby", ordered(prefix));
  let now = 1000,
    serial = 0;
  for (const id of ["a", "b"]) {
    addTwentyOnePlayer(match, id, id);
    match.players.at(-1)!.connected = true;
  }
  function send(playerId: string, type: TwentyOneCommand["type"], version?: number) {
    const player = match.players.find((p) => p.id === playerId)!;
    applyTwentyOneCommand(
      match,
      playerId,
      {
        id: `${++serial}`,
        roundId: match.roundId,
        type,
        ...(type === "hit" || type === "stand"
          ? { handVersion: version ?? player.handVersion }
          : {}),
      },
      now,
      `round-${serial}`,
      () => ordered(initial),
    );
  }
  function tick(at: number) {
    now = at;
    advanceTwentyOne(match, now);
  }
  function settle() {
    tick(
      Math.max(now, ...match.players.flatMap((p) => (p.busyUntil === null ? [] : [p.busyUntil]))),
    );
  }
  send("a", "ready");
  send("b", "ready");
  return { match, send, tick, settle };
}
test("36-card deck has unique cards, unbiased shuffle boundaries, and the agreed Russian values", () => {
  const deck = twentyOneDeck((upper) => upper - 1);
  assert.equal(deck.length, 36);
  assert.equal(new Set(deck.map((c) => `${c.rank}:${c.suit}`)).size, 36);
  assert.deepEqual(
    [face("J", "spades"), face("Q", "hearts"), face("K", "clubs"), face("A", "diamonds")].map(
      twentyOneValue,
    ),
    [2, 3, 4, 11],
  );
  assert.equal(
    twentyOneTotal([
      face("J", "spades"),
      face("Q", "hearts"),
      face("K", "clubs"),
      face("A", "diamonds"),
    ]),
    20,
  );
  assert.equal(twentyOneTotal([face("A", "spades"), face("A", "hearts")]), 22);
  assert.throws(() => twentyOneDeck(() => -1));
  assert.throws(() => createTwentyOneMatch("x", deck.slice(1)));
  assert.throws(() => createTwentyOneMatch("x", Array(36).fill(face("6", "spades"))));
});
test("ace is always 11 in the visible hand; the screenshot examples score king + 8 + 7 = 19 and two queens = 6", () => {
  assert.equal(
    twentyOneTotal([face("K", "spades"), face("8", "diamonds"), face("7", "hearts")]),
    19,
  );
  const { match, settle } = fixture([
    face("A", "spades"),
    face("Q", "hearts"),
    face("7", "clubs"),
    face("Q", "diamonds"),
  ]);
  settle();
  assert.equal(twentyOnePublicState(match, "a", 99999).players[0].total, 18);
  assert.equal(twentyOnePublicState(match, "b", 99999).players[1].total, 6);
});
test("start requires two connected ready seats, schedules alternate dealing and locks early inputs", () => {
  const one = createTwentyOneMatch("lobby", ordered(initial));
  addTwentyOnePlayer(one, "a", "A");
  one.players[0].connected = true;
  assert.throws(() =>
    applyTwentyOneCommand(one, "a", { id: "r", roundId: "lobby", type: "ready" }, 0, "n", () =>
      ordered(initial),
    ),
  );
  const { match, send, settle } = fixture();
  assert.equal(match.phase, "dealing");
  assert.deepEqual(
    match.players.map((p) => p.cards.map((c) => c.order)),
    [
      [0, 2],
      [1, 3],
    ],
  );
  assert.ok(match.players[0].cards[0].dealtAt < match.players[1].cards[0].dealtAt);
  assert.throws(() => send("a", "hit"));
  assert.throws(() => addTwentyOnePlayer(match, "c", "C"));
  settle();
  assert.equal(match.phase, "playing");
  assert.ok(match.players.every((p) => p.busyUntil === null));
});
test("ranks arrive only after the flight, opponents cannot see faces, totals, bust or private deck", () => {
  const { match, settle } = fixture();
  const arrival = match.players[0].cards[0].arrivesAt;
  assert.equal(twentyOnePublicState(match, "a", arrival - 1).players[0].total, 0);
  const own = twentyOnePublicState(match, "a", arrival);
  assert.equal(own.players[0].cards[0].face!.rank, "10");
  assert.equal(own.players[0].cards[1].face, null);
  assert.equal(own.players[0].total, 10);
  settle();
  const theirs = twentyOnePublicState(match, "b", 99999);
  assert.ok(theirs.players[0].cards.every((c) => c.face === null));
  assert.equal(theirs.players[0].total, null);
  assert.equal("deck" in theirs, false);
  own.players[0].cards[0].face!.rank = "6";
  assert.equal(match.players[0].cards[0].face.rank, "10");
});
test("hit adds exactly one card, blocks actions through flight and flip and rejects stale hands", () => {
  const { match, send, settle, tick } = fixture([...initial, face("6", "spades")]);
  settle();
  const old = match.players[0].handVersion;
  send("a", "hit");
  assert.equal(match.players[0].cards.length, 3);
  assert.equal(match.players[1].cards.length, 2);
  const card = match.players[0].cards[2];
  assert.equal(card.arrivesAt - card.dealtAt, TWENTY_ONE_FLIGHT_MS);
  assert.equal(match.players[0].busyUntil, card.arrivesAt + TWENTY_ONE_FLIP_MS);
  assert.throws(() => send("a", "hit"));
  tick(card.arrivesAt + TWENTY_ONE_FLIP_MS - 1);
  assert.throws(() => send("a", "stand"));
  settle();
  assert.throws(() => send("a", "stand", old));
  send("a", "stand");
  assert.equal(match.players[0].state, "stood");
});
test("exactly 21 and a bust automatically stop the hand after its animation", () => {
  for (const [rank, expected] of [
    ["7", "twenty-one"],
    ["10", "bust"],
  ] as const) {
    const { match, send, settle } = fixture([...initial, face(rank, "clubs")]);
    settle();
    send("a", "hit");
    settle();
    assert.equal(match.players[0].state, expected);
    assert.throws(() => send("a", "hit"));
    const view = twentyOnePublicState(match, "b", 99999);
    assert.equal(view.players[0].state, "done");
    assert.equal(view.players[0].total, null);
  }
});
test("hands reveal before the verdict; closest non-bust hand wins once", () => {
  const { match, send, settle, tick } = fixture([...initial, face("7", "spades")]);
  settle();
  send("a", "hit");
  settle();
  send("b", "stand");
  assert.equal(match.phase, "revealing");
  assert.equal(match.result, null);
  const reveal = twentyOnePublicState(match, "b", match.resolvesAt! - 1);
  assert.ok(reveal.players[0].cards.every((c) => c.face !== null));
  assert.equal(reveal.players[0].total, null);
  tick(match.resolvesAt!);
  assert.equal(match.phase, "complete");
  assert.equal(match.result!.winnerId, "a");
  assert.equal(match.players[0].score, 1);
  tick(99999);
  assert.equal(match.players[0].score, 1);
  assert.equal(twentyOnePublicState(match, "b", 99999).players[0].total, 21);
});
test("equal hands and a double bust are draws without a win; bust loses to a valid hand", () => {
  for (const [prefix, reason, winner] of [
    [
      [face("10", "spades"), face("10", "hearts"), face("7", "clubs"), face("7", "diamonds")],
      "tie",
      null,
    ],
    [
      [face("A", "spades"), face("A", "hearts"), face("A", "clubs"), face("A", "diamonds")],
      "both-bust",
      null,
    ],
    [
      [face("A", "spades"), face("9", "hearts"), face("A", "clubs"), face("6", "diamonds")],
      "bust",
      "b",
    ],
  ] as const) {
    const { match, send, settle, tick } = fixture([...prefix]);
    settle();
    for (const p of match.players) if (p.state === "choosing") send(p.id, "stand");
    tick(match.resolvesAt!);
    assert.equal(match.result!.reason, reason);
    assert.equal(match.result!.winnerId, winner);
    assert.equal(
      match.players.reduce((sum, p) => sum + p.score, 0),
      winner ? 1 : 0,
    );
  }
});
test("mutual rematch preserves wins, clears hands, replaces the deck and rejects previous rounds", () => {
  const { match, send, settle, tick } = fixture();
  settle();
  send("a", "stand");
  send("b", "stand");
  tick(match.resolvesAt!);
  const oldRound = match.roundId,
    ids = match.players.flatMap((p) => p.cards.map((c) => c.id)),
    scores = match.players.map((p) => p.score);
  send("a", "rematch");
  assert.equal(match.phase, "complete");
  send("b", "rematch");
  assert.equal(match.phase, "dealing");
  assert.equal(match.matchNumber, 2);
  assert.notEqual(match.roundId, oldRound);
  assert.deepEqual(
    match.players.map((p) => p.score),
    scores,
  );
  assert.ok(match.players.flatMap((p) => p.cards).every((c) => !ids.includes(c.id)));
  assert.throws(() =>
    applyTwentyOneCommand(
      match,
      "a",
      { id: "old", roundId: oldRound, type: "hit", handVersion: 1 },
      99999,
      "n",
      () => ordered(initial),
    ),
  );
});
