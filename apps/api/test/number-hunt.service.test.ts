import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { validateSync } from "class-validator";
import {
  createNumberHuntMatch,
  numberHuntSettings,
  type NumberHuntCommand,
  type NumberHuntSettings,
} from "@qwiza/minigames";
import { NumberHuntService } from "../src/minigames/number-hunt.service";
import { parseNumberHuntCommand } from "../src/minigames/number-hunt.gateway";
import { CreateNumberHuntDto } from "../src/minigames/number-hunt.controller";

class TestNumberHuntService extends NumberHuntService {
  protected newMatch(input: Partial<NumberHuntSettings>, roundId: string) {
    const settings = numberHuntSettings(input);
    return createNumberHuntMatch(
      roundId,
      settings,
      Array.from({ length: settings.numberCount }, (_, index) => index + 1),
    );
  }
}

test("authenticated number hunt rooms deduplicate flips, hide deck and restore shared progress on reconnect", () => {
  const service = new TestNumberHuntService();
  let now = 1000;
  service.now = () => now;
  try {
    const a = service.create("Аня", {}),
      b = service.join(a.roomId, "Макс");
    assert.throws(() => service.join(a.roomId, "Третий"));
    assert.throws(() => service.authenticate(a.roomId, randomUUID()));
    assert.equal(service.authenticate(a.roomId, a.token), a.playerId);
    service.connect(a.roomId, a.playerId, "a", true);
    service.connect(a.roomId, b.playerId, "b", true);
    const send = (playerId: string, body: Omit<NumberHuntCommand, "id" | "roundId">) =>
      service.command(a.roomId, playerId, {
        id: randomUUID(),
        roundId: service.snapshot(a.roomId).roundId,
        ...body,
      });
    send(a.playerId, { type: "ready" });
    send(b.playerId, { type: "ready" });
    const playing = service.snapshot(a.roomId);
    assert.ok(playing.cards.every((card) => card.number === null));
    const flip: NumberHuntCommand = {
      id: randomUUID(),
      roundId: playing.roundId,
      type: "flip",
      index: 0,
      turn: playing.turn,
    };
    service.command(a.roomId, a.playerId, flip);
    const once = service.snapshot(a.roomId);
    service.command(a.roomId, a.playerId, flip);
    assert.equal(service.snapshot(a.roomId).turn, once.turn);
    assert.equal(service.snapshot(a.roomId).nextNumber, 2);
    assert.throws(() => send(b.playerId, { type: "flip", index: 1, turn: once.turn }));
    assert.throws(() => send(a.playerId, { type: "flip", index: 1, turn: 0 }));
    service.connect(a.roomId, a.playerId, "a", false);
    service.connect(a.roomId, a.playerId, "a2", true);
    assert.equal(service.snapshot(a.roomId).cards[0].number, 1);
    send(a.playerId, { type: "flip", index: 4, turn: once.turn });
    assert.equal(service.snapshot(a.roomId).phase, "revealing");
    service.connect(a.roomId, a.playerId, "a2", false);
    now = 1900;
    const reset = service.snapshot(a.roomId);
    assert.equal(reset.turnPlayerId, b.playerId);
    assert.equal(reset.nextNumber, 1);
    assert.ok(reset.cards.every((card) => card.number === null));
    service.connect(a.roomId, a.playerId, "a3", true);
    for (let index = 0; index < 10; index++)
      send(b.playerId, { type: "flip", index, turn: service.snapshot(a.roomId).turn });
    const complete = service.snapshot(a.roomId);
    assert.deepEqual(complete.winnerIds, [b.playerId]);
    assert.equal(complete.players[1].score, 1);
    assert.equal("deck" in complete, false);
    assert.equal("mode" in complete.settings, false);
    assert.equal("teamId" in complete.players[0], false);
    assert.equal("turnTeamId" in complete, false);
    assert.equal("winnerTeamId" in complete, false);
    assert.equal(JSON.stringify(complete).includes(a.token), false);
    send(a.playerId, { type: "rematch" });
    assert.equal(service.snapshot(a.roomId).phase, "complete");
    send(b.playerId, { type: "rematch" });
    const rematch = service.snapshot(a.roomId);
    assert.equal(rematch.phase, "playing");
    assert.equal(rematch.matchNumber, 2);
    assert.equal(rematch.players[1].score, 1);
    assert.ok(rematch.cards.every((card) => card.number === null));
    assert.throws(() => service.command(a.roomId, b.playerId, { ...flip, id: randomUUID() }));
  } finally {
    service.onModuleDestroy();
  }
});

test("duel lobby cannot start alone or with an offline opponent", () => {
  const service = new TestNumberHuntService();
  service.now = () => 1000;
  try {
    const a = service.create("Аня", {});
    service.connect(a.roomId, a.playerId, "a", true);
    const ready = (playerId: string) =>
      service.command(a.roomId, playerId, {
        id: randomUUID(),
        roundId: service.snapshot(a.roomId).roundId,
        type: "ready",
      });
    assert.throws(() => ready(a.playerId));
    const b = service.join(a.roomId, "Макс");
    assert.throws(() => service.join(a.roomId, "Третий"));
    assert.throws(() => ready(a.playerId));
    service.connect(a.roomId, b.playerId, "b", true);
    ready(a.playerId);
    assert.equal(service.snapshot(a.roomId).phase, "lobby");
    service.connect(a.roomId, b.playerId, "b", false);
    assert.ok(service.snapshot(a.roomId).players.every((player) => !player.ready));
    assert.throws(() => ready(a.playerId));
    service.connect(a.roomId, b.playerId, "b2", true);
    ready(a.playerId);
    ready(b.playerId);
    assert.equal(service.snapshot(a.roomId).phase, "playing");
    assert.throws(() => service.join(a.roomId, "Поздний"));
  } finally {
    service.onModuleDestroy();
  }
});

test("transport rejects forged results, unknown properties and invalid action combinations", () => {
  const base = { id: randomUUID(), roundId: randomUUID() };
  const valid = { ...base, type: "flip", index: 0, turn: 0 };
  assert.deepEqual(parseNumberHuntCommand(valid), valid);
  for (const invalid of [
    null,
    {},
    { ...valid, index: 20 },
    { ...valid, index: NaN },
    { ...valid, index: 0.5 },
    { ...valid, turn: -1 },
    { ...valid, turn: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, number: 1 },
    { ...valid, score: 99 },
    { ...valid, playerId: randomUUID() },
    { ...valid, winnerIds: [] },
    { ...valid, type: "win" },
    { ...valid, teamId: "a" },
    { ...valid, type: "ready" },
    { ...base, type: "team", teamId: "a" },
    { ...base, type: "rematch", teamId: "a" },
  ])
    assert.throws(() => parseNumberHuntCommand(invalid));
});

test("create DTO accepts duel sizes and rejects former group modes and unknown fields", () => {
  const validate = (input: object) =>
    validateSync(Object.assign(new CreateNumberHuntDto(), input), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  for (const body of [
    { displayName: "Аня" },
    { displayName: "Аня", numberCount: 6 },
    { displayName: "Аня", numberCount: 10 },
    { displayName: "Аня", numberCount: 20 },
  ])
    assert.equal(validate(body).length, 0);
  for (const body of [
    { displayName: "" },
    { displayName: "Аня", mode: "duel" },
    { displayName: "Аня", mode: "free-for-all" },
    { displayName: "Аня", mode: "teams" },
    { displayName: "Аня", mode: null },
    { displayName: "Аня", numberCount: null },
    { displayName: "Аня", numberCount: "10" },
    { displayName: "Аня", numberCount: 21 },
    { displayName: "Аня", numberCount: 5 },
    { displayName: "Аня", playerCount: 4 },
  ])
    assert.ok(validate(body).length > 0);
  const service = new TestNumberHuntService();
  try {
    for (const numberCount of [5, 21, 6.5])
      assert.throws(() => service.create("Аня", { numberCount }));
  } finally {
    service.onModuleDestroy();
  }
});
