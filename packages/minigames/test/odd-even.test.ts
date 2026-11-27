import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addOddEvenPlayer,
  advanceOddEven,
  applyOddEvenCommand,
  createOddEvenMatch,
  ODD_EVEN_LAPS,
  oddEvenPublicState,
  type OddEvenCommand,
} from "../src/odd-even";

function setup(names = ["Аня", "Миша", "Лена"]) {
  const match = createOddEvenMatch("first");
  for (const name of names) addOddEvenPlayer(match, name, name);
  const send = (player: string, command: Omit<OddEvenCommand, "id" | "roundId">) =>
    applyOddEvenCommand(
      match,
      player,
      { ...command, id: "test", roundId: match.roundId },
      0,
      "second",
      () => 1,
    );
  for (const player of match.players) player.connected = true;
  for (const name of names) send(name, { type: "ready" });
  return { match, send };
}

test("keeps both the wager and opponents' balances private until the relevant reveal", () => {
  const { match, send } = setup();
  assert.throws(() => send("Миша", { type: "bet", turn: 1, amount: 1 }));
  assert.throws(() => send("Аня", { type: "bet", turn: 1, amount: 6 }));
  send("Аня", { type: "bet", turn: 1, amount: 3 });
  for (const viewer of [undefined, "Аня", "Миша", "Лена"]) {
    const view = oddEvenPublicState(match, viewer);
    assert.equal(view.chips, viewer ? 5 : null);
    assert.ok(!("stake" in view));
    assert.ok(view.players.every((p) => !("chips" in p)));
    assert.equal(view.transfer, null);
  }
  assert.throws(() => send("Лена", { type: "guess", turn: 1, parity: "odd" }));
  send("Миша", { type: "guess", turn: 1, parity: "odd" });
  assert.deepEqual(oddEvenPublicState(match).transfer, {
    amount: 3,
    guess: "odd",
    correct: true,
    paid: 3,
    fromId: "Аня",
    toId: "Миша",
  });
  assert.equal(oddEvenPublicState(match, "Аня").chips, 2);
  assert.equal(oddEvenPublicState(match, "Миша").chips, 8);
  advanceOddEven(match, match.deadline!, () => 0);
  assert.equal(match.bettor?.id, "Миша");
  assert.equal(match.guesser?.id, "Лена");
  assert.throws(() => send("Миша", { type: "bet", turn: 1, amount: 3 }));
  send("Миша", { type: "bet", turn: 2, amount: 8 });
  send("Лена", { type: "guess", turn: 2, parity: "odd" });
  assert.equal(match.transfer?.paid, 5);
  assert.equal(match.transfer?.fromId, "Лена");
  assert.equal(oddEvenPublicState(match, "Лена").chips, 0);
  assert.equal(
    match.players.reduce((sum, p) => sum + p.chips, 0),
    15,
  );
  advanceOddEven(match, match.deadline!, () => 0);
  assert.equal(match.bettor?.id, "Аня");
});

test("deadlines progress through three seat rotations and a rematch restores five chips", () => {
  const { match, send } = setup();
  // All choose odd on timeout against the automatic one-chip stake.
  advanceOddEven(match, 1_000_000, () => 1);
  assert.equal(match.phase, "complete");
  assert.equal(match.turn, 3 * ODD_EVEN_LAPS);
  assert.deepEqual(match.winnerIds, ["Аня", "Миша", "Лена"]);
  for (const player of match.players) send(player.id, { type: "rematch" });
  assert.equal(match.roundId, "second");
  assert.equal(match.bettor?.id, "Миша");
  assert.ok(match.players.every((player) => player.chips === 5 && player.score === 1));
});

test("finishes immediately after resolving the wager that leaves one player with chips", () => {
  const { match, send } = setup(["Аня", "Миша"]);
  send("Аня", { type: "bet", amount: 5, turn: 1 });
  send("Миша", { type: "guess", parity: "even", turn: 1 });
  advanceOddEven(match, match.deadline!, () => 0);
  assert.equal(match.phase, "complete");
  assert.deepEqual(match.winnerIds, ["Аня"]);
});
