import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DoubleBluffService } from "../src/minigames/double-bluff.service";
import { parseBluffCommand } from "../src/minigames/double-bluff.gateway";

test("private room views and command acknowledgements hide pending stakes; reconnect and deduplication preserve the sealed bid", () => {
  const service = new DoubleBluffService();
  let now = 1000;
  service.now = () => now;
  try {
    const a = service.create("Аня", undefined),
      b = service.join(a.roomId, "Макс");
    for (const [i, p] of [a, b].entries()) service.connect(a.roomId, p.playerId, String(i), true);
    for (const p of [a, b])
      service.command(a.roomId, p.playerId, {
        id: randomUUID(),
        roundId: service.snapshot(a.roomId).roundId,
        type: "ready",
      });
    now = 4000;
    const roundId = service.snapshot(a.roomId).roundId,
      command = { id: randomUUID(), roundId, type: "bid" as const, auction: 1, amount: 7 };
    assert.equal(service.command(a.roomId, a.playerId, command).players[0].bid, 7);
    assert.equal(service.command(a.roomId, a.playerId, command).players[0].tokens, 15);
    assert.equal(service.snapshot(a.roomId, b.playerId).players[0].bid, null);
    assert.equal(service.snapshot(a.roomId).players[0].bid, null);
    service.connect(a.roomId, a.playerId, "0", false);
    service.connect(a.roomId, a.playerId, "back", true);
    assert.equal(service.snapshot(a.roomId, a.playerId).players[0].bid, 7);
    service.command(a.roomId, b.playerId, {
      id: randomUUID(),
      roundId,
      type: "bid",
      auction: 1,
      amount: 2,
    });
    assert.deepEqual(
      service.snapshot(a.roomId).players.map((p) => p.bid),
      [7, 2],
    );
    assert.deepEqual(
      service.snapshot(a.roomId).players.map((p) => p.tokens),
      [8, 13],
    );
    service.seal(a.roomId);
    assert.throws(() => service.join(a.roomId, "Лишний"));
  } finally {
    service.onModuleDestroy();
  }
});
test("bluff commands reject forged balances, hidden bid dictionaries, invalid amounts and inappropriate auction fields", () => {
  const command = { id: randomUUID(), roundId: randomUUID(), type: "bid", auction: 1, amount: 5 };
  assert.deepEqual(parseBluffCommand(command), command);
  for (const input of [
    { ...command, tokens: 99 },
    { ...command, bids: {} },
    { ...command, amount: -1 },
    { ...command, amount: 16 },
    { ...command, amount: 1.5 },
    { ...command, auction: 6 },
    { ...command, type: "ready" },
  ])
    assert.throws(() => parseBluffCommand(input));
});
