import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addNumberHuntPlayer,
  advanceNumberHunt,
  applyNumberHuntCommand,
  createNumberHuntMatch,
  numberHuntDeck,
  numberHuntPublicState,
  numberHuntSettings,
  NUMBER_HUNT_REVEAL_MS,
} from "../src/number-hunt";
import type { NumberHuntCommand } from "../src/number-hunt";

function fixture(count = 2) {
  const settings = numberHuntSettings();
  const deck = Array.from({ length: settings.numberCount }, (_, index) => index + 1);
  const match = createNumberHuntMatch("round", settings, deck);
  for (let index = 0; index < count; index++) {
    addNumberHuntPlayer(match, `p${index}`, `Игрок ${index}`);
    match.players[index].connected = true;
  }
  let id = 0;
  const send = (playerId: string, command: Omit<NumberHuntCommand, "id" | "roundId">, now = 1000) =>
    applyNumberHuntCommand(
      match,
      playerId,
      { id: String(id++), roundId: match.roundId, ...command },
      now,
      `round${id}`,
      () => [...deck].reverse(),
    );
  const ready = () => {
    for (const player of match.players) send(player.id, { type: "ready" });
  };
  const flip = (index: number, now = 1000) =>
    send(match.turnPlayerId!, { type: "flip", index, turn: match.turn }, now);
  return { match, send, ready, flip, deck };
}

test("duel size defaults to ten, accepts 6–20 and decks remain full permutations", () => {
  assert.deepEqual(numberHuntSettings(), { numberCount: 10 });
  for (let count = 6; count <= 20; count++) {
    const settings = numberHuntSettings({ numberCount: count });
    const deck = numberHuntDeck(count, () => 0);
    assert.equal(new Set(deck).size, count);
    assert.deepEqual(
      [...deck].sort((a, b) => a - b),
      Array.from({ length: count }, (_, i) => i + 1),
    );
    const match = createNumberHuntMatch("r", settings, deck);
    deck[0] = -1;
    assert.ok(match.deck.every((value) => value >= 1));
  }
  for (const count of [5, 21, 8.5, NaN])
    assert.throws(() => numberHuntSettings({ numberCount: count }));
  assert.throws(() => numberHuntDeck(4, () => 0));
  assert.throws(() => numberHuntDeck(10, (upper) => upper));
  assert.throws(() => createNumberHuntMatch("r", {}, Array(10).fill(1)));
});

test("duel requires exactly two connected players and rejects a third seat", () => {
  const { match, send, ready } = fixture(1);
  assert.throws(() => send("p0", { type: "ready" }));
  addNumberHuntPlayer(match, "p1", "Соперник");
  assert.ok(match.players.every((player) => !player.ready));
  assert.throws(() => addNumberHuntPlayer(match, "extra", "Третий"));
  assert.throws(() => send("p0", { type: "ready" }));
  match.players[1].connected = true;
  ready();
  assert.equal(match.phase, "playing");
  assert.throws(() => addNumberHuntPlayer(match, "late", "Поздний"));
});

test("correct cards remain open; wrong card reveals then hides the entire attempt without reshuffling", () => {
  const { match, ready, flip, deck } = fixture();
  assert.ok(numberHuntPublicState(match).cards.every((card) => card.number === null));
  ready();
  flip(0);
  flip(1);
  assert.equal(match.turnPlayerId, "p0");
  assert.equal(match.nextNumber, 3);
  flip(4, 2000);
  assert.equal(match.phase, "revealing");
  assert.deepEqual(
    numberHuntPublicState(match)
      .cards.filter((card) => card.number !== null)
      .map((card) => card.number),
    [1, 2, 5],
  );
  assert.throws(() => flip(2));
  advanceNumberHunt(match, 2000 + NUMBER_HUNT_REVEAL_MS - 1);
  assert.equal(match.phase, "revealing");
  advanceNumberHunt(match, 2000 + NUMBER_HUNT_REVEAL_MS);
  assert.equal(match.phase, "playing");
  assert.equal(match.turnPlayerId, "p1");
  assert.equal(match.nextNumber, 1);
  assert.ok(numberHuntPublicState(match).cards.every((card) => card.number === null));
  assert.deepEqual(match.deck, deck);
  flip(0, 3000);
  assert.equal(match.nextNumber, 2);
});

test("turn and round guards reject stale, wrong-player, duplicate-card and disconnected actions", () => {
  const { match, ready, send, flip } = fixture();
  ready();
  assert.throws(() => send("p1", { type: "flip", index: 0, turn: match.turn }));
  const stale = match.turn;
  flip(0);
  assert.throws(() => send("p0", { type: "flip", index: 1, turn: stale }));
  assert.throws(() => flip(0));
  for (const index of [-1, 10, NaN, 1.5]) assert.throws(() => flip(index));
  assert.throws(() =>
    applyNumberHuntCommand(
      match,
      "p0",
      { id: "stale", roundId: "round", type: "flip", index: 1, turn: match.turn },
      1000,
      "new",
      () => [],
    ),
  );
  match.players[0].connected = false;
  assert.throws(() => flip(1));
  match.players[0].connected = true;
  flip(3, 2000);
  advanceNumberHunt(match, 3000);
  assert.equal(match.turnPlayerId, "p1");
  flip(3, 3000);
  advanceNumberHunt(match, 4000);
  assert.equal(match.turnPlayerId, "p0");
});

test("public state omits hidden deck and is isolated from mutation; individual win and mutual rematch preserve score", () => {
  const { match, ready, flip, send } = fixture();
  ready();
  flip(0);
  const view = numberHuntPublicState(match);
  assert.equal("deck" in view, false);
  assert.equal("mode" in view.settings, false);
  assert.equal("teamId" in view.players[0], false);
  assert.equal("turnTeamId" in view, false);
  assert.equal("winnerTeamId" in view, false);
  view.settings.numberCount = 99;
  view.cards[0].number = 99;
  view.players[0].score = 99;
  assert.equal(match.settings.numberCount, 10);
  assert.equal(match.deck[0], 1);
  assert.equal(match.players[0].score, 0);
  for (let index = 1; index < 10; index++) flip(index);
  assert.deepEqual(match.winnerIds, ["p0"]);
  assert.equal(match.players[0].score, 1);
  assert.throws(() => flip(0));
  const oldRound = match.roundId;
  send("p0", { type: "rematch" });
  assert.equal(match.phase, "complete");
  send("p1", { type: "rematch" });
  assert.equal(match.phase, "playing");
  assert.notEqual(match.roundId, oldRound);
  assert.equal(match.turnPlayerId, "p1");
  assert.deepEqual(
    match.deck,
    Array.from({ length: 10 }, (_, index) => 10 - index),
  );
  assert.equal(match.players[0].score, 1);
});
