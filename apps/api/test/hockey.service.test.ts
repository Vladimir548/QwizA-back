import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { HockeyService } from "../src/minigames/hockey.service";
import { parseHockeyCommand, parseHockeyInput } from "../src/minigames/hockey.gateway";

test("hockey rooms authenticate seats, deduplicate ready, stream movement, pause and restore", () => {
  const service = new HockeyService();
  let now = 1000;
  service.now = () => now;
  try {
    const a = service.create("Аня", undefined),
      b = service.join(a.roomId, "Ника");
    assert.equal(service.authenticate(a.roomId, a.token), a.playerId);
    assert.throws(() => service.authenticate(a.roomId, b.token + "0"));
    assert.throws(() => service.join(a.roomId, "Третий"));
    service.connect(a.roomId, a.playerId, "a", true);
    service.connect(a.roomId, b.playerId, "b", true);
    const roundId = service.snapshot(a.roomId).roundId;
    const command = { id: randomUUID(), roundId, type: "ready" as const };
    service.command(a.roomId, a.playerId, command);
    service.command(a.roomId, a.playerId, command);
    assert.equal(service.snapshot(a.roomId).phase, "lobby");
    service.command(a.roomId, b.playerId, { ...command, id: randomUUID() });
    now = 4000;
    assert.equal(service.snapshot(a.roomId).phase, "playing");
    service.input(a.roomId, b.playerId, { roundId, sequence: 1, x: 600, y: 80 });
    now += 200;
    const moved = service.snapshot(a.roomId);
    assert.ok(moved.mallets[1].x < 850);
    assert.equal(moved.mallets[0].x, 150);
    service.connect(a.roomId, b.playerId, "b", false);
    assert.equal(service.snapshot(a.roomId).phase, "paused");
    const frozen = service.snapshot(a.roomId).puck;
    now += 10000;
    assert.deepEqual(service.snapshot(a.roomId).puck, frozen);
    service.connect(a.roomId, b.playerId, "new-b", true);
    assert.equal(service.snapshot(a.roomId).phase, "countdown");
    assert.equal(service.snapshot(a.roomId).roundId, roundId);
    assert.ok(!JSON.stringify(service.snapshot(a.roomId)).includes(a.token));
  } finally {
    service.onModuleDestroy();
  }
});
test("hockey transport rejects fabricated scores, extra fields and invalid coordinates", () => {
  const command = { id: randomUUID(), roundId: randomUUID(), type: "ready" };
  assert.deepEqual(parseHockeyCommand(command), command);
  for (const input of [
    null,
    {},
    { ...command, type: "goal" },
    { ...command, goals: 7 },
    { ...command, playerId: "other" },
  ])
    assert.throws(() => parseHockeyCommand(input));
  const input = { roundId: command.roundId, sequence: 1, x: 500, y: 280 };
  assert.deepEqual(parseHockeyInput(input), input);
  for (const bad of [
    null,
    {},
    { ...input, sequence: -1 },
    { ...input, x: NaN },
    { ...input, y: Infinity },
    { ...input, x: 1e6 },
    { ...input, goals: 7 },
  ])
    assert.equal(parseHockeyInput(bad), null);
});
