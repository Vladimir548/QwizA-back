import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MEMORY_SYMBOLS, createMemoryMatch, type MemoryCommand } from "@qwiza/minigames";
import { MemoryService } from "../src/minigames/memory.service";
import { parseMemoryCommand } from "../src/minigames/memory.gateway";

class TestMemoryService extends MemoryService {
  protected newMatch(_settings: undefined, roundId: string) {
    return createMemoryMatch(roundId, [...MEMORY_SYMBOLS, ...MEMORY_SYMBOLS]);
  }
}

test("memory room uses authenticated seats, deduplicates commands and restores the same shared board", () => {
  const service = new TestMemoryService();
  let now = 1000;
  service.now = () => now;
  try {
    const a = service.create("Аня", undefined),
      b = service.join(a.roomId, "Ника");
    assert.throws(() => service.join(a.roomId, "Третий"));
    assert.throws(() => service.authenticate(a.roomId, "bad"));
    assert.equal(service.authenticate(a.roomId, a.token), a.playerId);
    service.connect(a.roomId, a.playerId, "a", true);
    service.connect(a.roomId, b.playerId, "b", true);
    function send(playerId: string, payload: Omit<MemoryCommand, "id" | "roundId">) {
      return service.command(a.roomId, playerId, {
        id: randomUUID(),
        roundId: service.snapshot(a.roomId).roundId,
        ...payload,
      });
    }
    send(a.playerId, { type: "ready" });
    send(b.playerId, { type: "ready" });
    assert.ok(service.snapshot(a.roomId).cards.every((card) => card.symbol === null));
    const flip: MemoryCommand = {
      id: randomUUID(),
      roundId: service.snapshot(a.roomId).roundId,
      type: "flip",
      index: 0,
      turn: 0,
    };
    service.command(a.roomId, a.playerId, flip);
    service.command(a.roomId, a.playerId, flip);
    assert.equal(service.snapshot(a.roomId).cards.filter((card) => card.symbol !== null).length, 1);
    assert.throws(() => send(b.playerId, { type: "flip", index: 1, turn: 0 }));
    send(a.playerId, { type: "flip", index: 1, turn: 0 });
    service.connect(a.roomId, a.playerId, "a", false);
    service.connect(a.roomId, a.playerId, "a2", true);
    assert.equal(service.snapshot(a.roomId).phase, "revealing");
    now = 5000;
    const restored = service.snapshot(a.roomId);
    assert.equal(restored.turnPlayerId, b.playerId);
    assert.ok(restored.cards.every((card) => card.symbol === null));
    send(b.playerId, { type: "flip", index: 0, turn: restored.turn });
    send(b.playerId, { type: "flip", index: 8, turn: restored.turn });
    const result = service.snapshot(a.roomId);
    assert.equal(result.players[1].pairs, 1);
    assert.equal(result.turnPlayerId, b.playerId);
    assert.ok(!JSON.stringify(result).includes(a.token));
    assert.equal("deck" in result, false);
  } finally {
    service.onModuleDestroy();
  }
});

test("memory commands reject unknown fields, client results and invalid card/turn values", () => {
  const valid = { id: randomUUID(), roundId: randomUUID(), type: "flip", index: 0, turn: 0 };
  assert.deepEqual(parseMemoryCommand(valid), valid);
  for (const input of [
    null,
    {},
    { ...valid, index: 16 },
    { ...valid, index: NaN },
    { ...valid, turn: -1 },
    { ...valid, type: "win" },
    { ...valid, score: 1 },
    { ...valid, playerId: "other" },
    { ...valid, type: "ready" },
  ])
    assert.throws(() => parseMemoryCommand(input));
});
