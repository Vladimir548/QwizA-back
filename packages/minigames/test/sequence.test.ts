import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSequenceMatch,
  addSequencePlayer,
  applySequenceCommand,
  advanceSequence,
  sequenceForRound,
  sequencePublicState,
  SEQUENCE_SHAPES,
  type SequenceShape,
} from "../src/sequence";
import { awardTopicPrizes } from "../src/topic-event";

function fixture(count = 3) {
  const match = createSequenceMatch("lobby");
  let now = 1000,
    serial = 0;
  for (let i = 0; i < count; i++) {
    addSequencePlayer(match, `p${i}`, `Игрок ${i}`);
    match.players[i].connected = true;
  }
  const send = (
    id: string,
    type: "ready" | "submit" | "rematch",
    answer?: SequenceShape[],
    round = match.round,
  ) =>
    applySequenceCommand(
      match,
      id,
      {
        id: String(serial++),
        roundId: match.roundId,
        type,
        ...(type === "submit" ? { round, answer } : {}),
      },
      now,
      `match-${serial}`,
      () => 0,
    );
  const at = (time: number) => {
    now = time;
    advanceSequence(match, now, () => 0);
  };
  const start = () => {
    for (const p of match.players) send(p.id, "ready");
  };
  return { match, send, at, start };
}
test("every round generates a fresh bounded chain with six through fifteen symbols and at most three copies of each", () => {
  let seed = 123;
  for (let round = 1; round <= 10; round++)
    for (let run = 0; run < 20; run++) {
      const chain = sequenceForRound(round, (upper) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % upper;
      });
      assert.equal(chain.length, 5 + round);
      for (const shape of SEQUENCE_SHAPES) assert.ok(chain.filter((s) => s === shape).length <= 3);
    }
  assert.throws(() => sequenceForRound(11, () => 0));
  assert.throws(() => sequenceForRound(1, () => NaN));
});
test("all ready players get exactly four seconds; answers are hidden and early, duplicate, stale-round and incomplete answers cannot advance progress", () => {
  const { match, send, at, start } = fixture();
  start();
  const chain = [...match.sequence];
  const shown = sequencePublicState(match);
  assert.equal(match.phase, "showing");
  assert.equal(match.deadline, 5000);
  shown.sequence![0] = "heart";
  assert.notDeepEqual(shown.sequence, match.sequence);
  assert.throws(() => send("p0", "submit", chain));
  at(4999);
  assert.equal(match.phase, "showing");
  at(5000);
  assert.equal(sequencePublicState(match).sequence, null);
  assert.equal(match.deadline, 35000);
  assert.throws(() => send("p0", "submit", chain.slice(1)));
  assert.throws(() => send("p0", "submit", chain, 2));
  send("p0", "submit", chain);
  assert.equal(match.players[0].points, 1);
  assert.equal(match.phase, "answering");
  assert.throws(() => send("p0", "submit", chain));
  at(35000);
  assert.equal(match.phase, "complete");
  assert.deepEqual(match.winnerIds, ["p0"]);
  assert.ok(match.players.slice(1).every((p) => p.state === "out"));
});
test("a wrong answer eliminates, surviving players keep playing longer new chains and eliminated players cannot submit", () => {
  const { match, start, at, send } = fixture();
  start();
  const chain = [...match.sequence];
  at(5000);
  send("p0", "submit", chain);
  send("p1", "submit", chain);
  send(
    "p2",
    "submit",
    chain.map(() => "heart"),
  );
  assert.equal(match.phase, "between");
  assert.equal(match.players[2].state, "out");
  at(7000);
  assert.equal(match.round, 2);
  assert.equal(match.sequenceLength, 7);
  const next = [...match.sequence];
  at(11000);
  assert.throws(() => send("p2", "submit", next));
  send("p0", "submit", next);
  send(
    "p1",
    "submit",
    next.map(() => "heart"),
  );
  assert.deepEqual(match.winnerIds, ["p0"]);
  assert.equal(match.players[0].score, 1);
  at(100000);
  assert.equal(match.players[0].score, 1);
  for (const p of match.players) send(p.id, "rematch");
  assert.equal(match.round, 1);
  assert.equal(match.matchNumber, 2);
  assert.equal(match.sequenceLength, 6);
  assert.ok(match.players.every((p) => p.points === 0 && p.state === "thinking"));
  assert.equal(match.players[0].score, 1);
});
test("all survivors who finish round ten share first place and the entire prize, without awarding eliminated participants", () => {
  const { match, start, at, send } = fixture();
  start();
  for (let round = 1; round <= 10; round++) {
    assert.equal(match.round, round);
    const chain = [...match.sequence];
    at(match.deadline!);
    for (const p of match.players) send(p.id, "submit", chain);
    if (round < 10) {
      assert.equal(match.phase, "between");
      at(match.deadline!);
    }
  }
  assert.equal(match.phase, "complete");
  assert.deepEqual(match.winnerIds, ["p0", "p1", "p2"]);
  assert.ok(match.players.every((p) => p.points === 10 && p.score === 1));
  const prizes = awardTopicPrizes(
    [
      { id: "a", name: "A", points: 10 },
      { id: "b", name: "B", points: 10 },
      { id: "c", name: "C", points: 9 },
    ],
    101,
    "sequence",
  );
  assert.deepEqual(
    prizes.map((p) => [p.place, p.prize]),
    [
      [1, 51],
      [1, 50],
      [3, 0],
    ],
  );
});
test("simultaneous failure and abandoned players time out without a fabricated winner", () => {
  const { match, start, at } = fixture();
  start();
  match.players[0].connected = false;
  at(35000);
  assert.equal(match.phase, "complete");
  assert.deepEqual(match.winnerIds, []);
  assert.ok(match.players.every((p) => p.score === 0));
});
