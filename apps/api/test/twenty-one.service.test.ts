import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createTwentyOneMatch, twentyOneDeck } from "@qwiza/minigames";
import { TwentyOneService } from "../src/minigames/twenty-one.service";
import { parseTwentyOneCommand } from "../src/minigames/twenty-one.gateway";

class TestTwentyOneService extends TwentyOneService {
  protected newMatch(_settings: undefined, roundId: string) {
    return createTwentyOneMatch(
      roundId,
      twentyOneDeck((upper) => upper - 1),
    );
  }
}
test("21 uses authenticated private hands, deduplicates a draw and restores it without dealing twice", () => {
  const service = new TestTwentyOneService();
  let now = 1000;
  service.now = () => now;
  try {
    const a = service.create("Аня", undefined),
      b = service.join(a.roomId, "Ника");
    assert.equal(service.authenticate(a.roomId, a.token), a.playerId);
    assert.throws(() => service.authenticate(a.roomId, "bad"));
    assert.throws(() => service.join(a.roomId, "Третий"));
    service.connect(a.roomId, a.playerId, "a", true);
    service.connect(a.roomId, b.playerId, "b", true);
    for (const playerId of [a.playerId, b.playerId])
      service.command(a.roomId, playerId, {
        id: randomUUID(),
        roundId: service.snapshot(a.roomId).roundId,
        type: "ready",
      });
    now = Math.max(...service.snapshot(a.roomId).players.map((p) => p.busyUntil!));
    const before = service.snapshot(a.roomId, a.playerId);
    assert.equal(before.phase, "playing");
    assert.ok(before.players[0].cards.every((c) => c.face !== null));
    assert.ok(before.players[1].cards.every((c) => c.face === null));
    const command = {
      id: randomUUID(),
      roundId: before.roundId,
      type: "hit" as const,
      handVersion: before.players[0].handVersion,
    };
    service.command(a.roomId, a.playerId, command);
    service.command(a.roomId, a.playerId, command);
    assert.equal(service.snapshot(a.roomId).players[0].cards.length, 3);
    service.connect(a.roomId, a.playerId, "a2", true);
    service.connect(a.roomId, a.playerId, "a", false);
    now = service.snapshot(a.roomId).players[0].busyUntil!;
    const own = service.snapshot(a.roomId, a.playerId),
      other = service.snapshot(a.roomId, b.playerId);
    assert.equal(own.players[0].cards.length, 3);
    assert.equal(own.players[0].cards[2].face!.rank, "10");
    assert.equal(other.players[0].cards[2].face, null);
    assert.equal(other.players[0].total, null);
    assert.equal(other.players[0].state, "done");
    assert.ok(!JSON.stringify(own).includes(a.token));
    assert.equal("deck" in own, false);
  } finally {
    service.onModuleDestroy();
  }
});
test("21 transport rejects fabricated cards/results, client identity and stale/invalid hand versions", () => {
  const valid = { id: randomUUID(), roundId: randomUUID(), type: "hit", handVersion: 1 };
  assert.deepEqual(parseTwentyOneCommand(valid), valid);
  for (const invalid of [
    null,
    {},
    { ...valid, handVersion: undefined },
    { ...valid, handVersion: 0 },
    { ...valid, handVersion: 1.5 },
    { ...valid, handVersion: NaN },
    { ...valid, face: "A" },
    { ...valid, total: 21 },
    { ...valid, playerId: "other" },
    { ...valid, type: "ready" },
  ])
    assert.throws(() => parseTwentyOneCommand(invalid));
});
