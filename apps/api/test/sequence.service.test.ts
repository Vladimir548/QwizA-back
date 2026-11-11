import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { SequenceService } from "../src/minigames/sequence.service";
import { parseSequenceCommand } from "../src/minigames/sequence.gateway";
import type { SequenceCommand } from "@qwiza/minigames";
class TestService extends SequenceService {
  protected randomIndex = () => 0;
}
test("authenticated shared rooms hide the sequence after four seconds and retain an accepted answer on reconnect", () => {
  const service = new TestService();
  let now = 1000;
  service.now = () => now;
  try {
    const a = service.create("Аня", undefined),
      b = service.join(a.roomId, "Макс");
    for (const [i, s] of [a, b].entries())
      service.connect(a.roomId, s.playerId, `socket${i}`, true);
    assert.throws(() => service.authenticate(a.roomId, randomUUID()));
    const send = (id: string, type: SequenceCommand["type"], answer?: SequenceCommand["answer"]) =>
      service.command(a.roomId, id, {
        id: randomUUID(),
        roundId: service.snapshot(a.roomId).roundId,
        type,
        ...(type === "submit" ? { round: 1, answer } : {}),
      });
    send(a.playerId, "ready");
    send(b.playerId, "ready");
    const shown = service.snapshot(a.roomId);
    assert.equal(shown.phase, "showing");
    const answer = [...shown.sequence!];
    now = 5000;
    assert.equal(service.snapshot(a.roomId).sequence, null);
    const command: SequenceCommand = {
      id: randomUUID(),
      roundId: shown.roundId,
      type: "submit",
      round: 1,
      answer,
    };
    service.command(a.roomId, a.playerId, command);
    service.command(a.roomId, a.playerId, command);
    service.connect(a.roomId, a.playerId, "socket0", false);
    service.connect(a.roomId, a.playerId, "back", true);
    assert.equal(service.snapshot(a.roomId).players[0].state, "passed");
    assert.equal(service.snapshot(a.roomId).players[0].points, 1);
    now = 35000;
    assert.deepEqual(service.snapshot(a.roomId).winnerIds, [a.playerId]);
    service.seal(a.roomId);
    assert.throws(() => send(a.playerId, "rematch"));
    assert.equal(JSON.stringify(service.snapshot(a.roomId)).includes(a.token), false);
  } finally {
    service.onModuleDestroy();
  }
});
test("command validation rejects hidden-state injection, invalid shapes, oversize answers and malformed round numbers", () => {
  const envelope = { id: randomUUID(), roundId: randomUUID() };
  const valid = {
    ...envelope,
    type: "submit",
    round: 1,
    answer: ["circle", "triangle", "square", "star", "heart", "diamond"],
  };
  assert.deepEqual(parseSequenceCommand(valid), valid);
  for (const value of [
    null,
    { ...valid, round: 11 },
    { ...valid, answer: Array(16).fill("circle") },
    { ...valid, answer: ["unknown", ...valid.answer.slice(1)] },
    { ...valid, correct: true },
    { ...valid, deadline: 0 },
    { ...valid, playerId: randomUUID() },
    { ...valid, type: "ready" },
  ])
    assert.throws(() => parseSequenceCommand(value));
});
