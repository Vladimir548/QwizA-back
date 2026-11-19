import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { isMinigameComplete, QUIZ_MINIGAME_ROUNDS } from "@qwiza/minigames";
import { HotPotatoService } from "../src/minigames/hot-potato.service";

test("a sealed quiz table runs three elimination rounds and preserves series wins", () => {
  const service = new HotPotatoService();
  let now = 1000;
  service.now = () => now;
  try {
    const first = service.create("Аня", undefined, QUIZ_MINIGAME_ROUNDS);
    const { roomId } = first;
    const second = service.join(roomId, "Макс");
    service.seal(roomId);
    assert.throws(() => service.join(roomId, "Зритель"));
    for (const p of [first, second]) service.connect(roomId, p.playerId, p.token, true);
    const vote = (type: "ready" | "rematch") => {
      const { roundId } = service.snapshot(roomId);
      for (const p of [first, second]) {
        service.command(roomId, p.playerId, { type, id: randomUUID(), roundId });
      }
    };
    for (let round = 1; round <= QUIZ_MINIGAME_ROUNDS; round++) {
      vote(round === 1 ? "ready" : "rematch");
      now = service.snapshot(roomId).startsAt!;
      const market = service.snapshot(roomId);
      assert.equal(market.phase, "running");
      now = market.explodesAt!;
      const result = service.snapshot(roomId);
      assert.equal(result.lastExplosion?.playerId, market.holderId);
      assert.equal(result.winnerIds.length, 1);
      assert.equal(result.series?.round, round);
      assert.equal(
        Object.values(result.series!.wins).reduce((a, b) => a + b, 0),
        round,
      );
      assert.equal(isMinigameComplete(result), round === QUIZ_MINIGAME_ROUNDS);
    }
    assert.throws(() => vote("rematch"));
  } finally {
    service.onModuleDestroy();
  }
});
