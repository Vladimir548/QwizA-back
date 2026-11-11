import assert from "node:assert/strict";
import { test } from "node:test";
import {
  duelMinigames,
  duelBalance,
  maxDuelStake,
  validateDuel,
  earnsDuelChallenge,
  duelTransfers,
  duelWinner,
  type DuelEvent,
} from "../src/duel";
const players = [
  { id: "a", name: "А", score: 8000 },
  { id: "b", name: "Б", score: 5000 },
];
const duel: DuelEvent = {
  id: "d",
  challengerId: "a",
  opponentId: "b",
  kind: "memory",
  stake: 1500,
  phase: "playing",
};
test("duels use only catalog duel games and limit stakes to 30% of the smaller balance", () => {
  assert.deepEqual(duelMinigames(), [
    "memory",
    "hockey",
    "twenty-one",
    "number-hunt",
    "double-bluff",
    "firefight",
  ]);
  assert.equal(maxDuelStake(players, "a", "b"), 1500);
  for (const stake of [-1, 0, 1501, 1.5, NaN, Infinity])
    assert.throws(() => validateDuel(players, "a", "b", "memory", stake));
  for (const kind of ["moment", "zone", "shooting", "falling-floor", "unknown"])
    assert.throws(() => validateDuel(players, "a", "b", kind, 100));
  for (const kind of duelMinigames())
    assert.doesNotThrow(() => validateDuel(players, "a", "b", kind, 1500));
  assert.throws(() => validateDuel(players, "a", "a", "memory", 1));
  assert.equal(maxDuelStake([{ ...players[0], score: -5 }, players[1]], "a", "b"), 0);
});
test("team stakes use the full team balance and forbid teammates", () => {
  const teams = [
    ...players.map((p) => ({ ...p, accountId: "t1" })),
    { id: "c", name: "В", score: 900, accountId: "t2" },
    { id: "d", name: "Г", score: 100, accountId: "t2" },
  ];
  assert.equal(duelBalance(teams, "a"), 13000);
  assert.equal(maxDuelStake(teams, "a", "c"), 300);
  assert.throws(() => validateDuel(teams, "a", "b", "hockey", 1));
});
test("challenge cycles every five correct answers independently of random three-answer rewards", () => {
  for (let i = 1; i <= 16; i++) assert.equal(earnsDuelChallenge(i - 1, i), i % 5 === 0);
  assert.equal(earnsDuelChallenge(5, 5), false);
  assert.equal(earnsDuelChallenge(5, 0), false);
});
test("duel settlements conserve scores and recognize all engine winner shapes including draws", () => {
  assert.deepEqual(duelTransfers(duel, "b"), { b: 1500, a: -1500 });
  assert.deepEqual(duelTransfers(duel, null), {});
  assert.throws(() => duelTransfers(duel, "outsider"));
  for (const snapshot of [{ winnerId: "a" }, { winnerIds: ["a"] }, { result: { winnerId: "a" } }])
    assert.equal(duelWinner({ phase: "complete", ...snapshot }), "a");
  for (const snapshot of [{ winnerIds: ["a", "b"] }, { result: { winnerId: null } }])
    assert.equal(duelWinner({ phase: "complete", ...snapshot }), null);
  assert.throws(() => duelWinner({ phase: "playing", winnerId: "a" }));
});
