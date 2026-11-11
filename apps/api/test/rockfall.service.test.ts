import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { RockfallService } from "../src/minigames/rockfall.service";
import { RockfallGateway, parseRockfallInput } from "../src/minigames/rockfall.gateway";
import { TopicMinigamesService } from "../src/rooms/topic-minigames.service";
import { MomentService } from "../src/minigames/moment.service";
import { ZoneService } from "../src/minigames/zone.service";
import { ShootingService } from "../src/minigames/shooting.service";
import { FallingFloorService } from "../src/minigames/falling-floor.service";
import type { Socket } from "socket.io";
import type { TopicMinigameEvent } from "@qwiza/minigames";
class TestService extends RockfallService {
  protected randomIndex = () => 0;
}
test("authenticated controls retain jump acknowledgements and an immediate stop bypasses movement throttling", () => {
  const service = new TestService();
  let now = 1000;
  service.now = () => now;
  try {
    const a = service.create("Аня", undefined),
      b = service.join(a.roomId, "Макс");
    for (const [i, s] of [a, b].entries()) service.connect(a.roomId, s.playerId, String(i), true);
    for (const s of [a, b])
      service.command(a.roomId, s.playerId, {
        id: randomUUID(),
        roundId: service.snapshot(a.roomId).roundId,
        type: "ready",
      });
    now = 4000;
    const roundId = service.snapshot(a.roomId).roundId;
    const gateway = new RockfallGateway(service),
      socket = { data: { roomId: a.roomId, playerId: a.playerId } } as unknown as Socket;
    gateway.input(socket, { roundId, seq: 0, dx: 1, jumpSeq: 0 });
    socket.data.lastRockfallInput = performance.now() + 1000;
    now = 4010;
    gateway.input(socket, { roundId, seq: 1, dx: 0, jumpSeq: 1 });
    const p = service.snapshot(a.roomId).players[0];
    assert.equal(p.inputSeq, 1);
    assert.equal(p.jumpSeq, 1);
    assert.ok(p.vy > 0);
    const x = p.x;
    now = 4200;
    assert.equal(service.snapshot(a.roomId).players[0].x, x);
    service.connect(a.roomId, a.playerId, "0", false);
    service.connect(a.roomId, a.playerId, "back", true);
    assert.equal(service.snapshot(a.roomId).players[0].jumpSeq, 1);
    assert.throws(() => service.authenticate(a.roomId, randomUUID()));
  } finally {
    service.onModuleDestroy();
  }
});
test("input parser rejects positions, velocity, forged clocks, extra axes and invalid jump sequences", () => {
  const valid = { roundId: randomUUID(), seq: 1, dx: 1, jumpSeq: 1 };
  assert.deepEqual(parseRockfallInput(valid), valid);
  for (const input of [
    null,
    { ...valid, y: 4 },
    { ...valid, dy: 1 },
    { ...valid, vy: 99 },
    { ...valid, now: 0 },
    { ...valid, dx: NaN },
    { ...valid, jumpSeq: -1 },
    { ...valid, jumpSeq: 1.2 },
  ])
    assert.equal(parseRockfallInput(input), null);
});
test("topic games can select and seal Rockfall and rank players by server survival time", () => {
  const moment = new MomentService(),
    zone = new ZoneService(),
    shooting = new ShootingService(),
    floor = new FallingFloorService(),
    rocks = new TestService();
  let now = 1000;
  rocks.now = () => now;
  try {
    const bridge = new TopicMinigamesService(
      moment,
      zone,
      shooting,
      floor,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      rocks,
    );
    const players = [
      { id: "a", name: "Аня" },
      { id: "b", name: "Макс" },
      { id: "c", name: "Ника" },
    ];
    const event: TopicMinigameEvent = {
      topicId: "t",
      title: "Тема",
      roundIndex: 0,
      prize: 1000,
      options: ["rockfall"],
      selected: "rockfall",
      participantIds: players.map((p) => p.id),
      voterIds: players.map((p) => p.id),
      votes: {},
    };
    const match = bridge.ensure("quiz", event, players),
      sessions = Object.values(match.sessions),
      id = sessions[0].roomId;
    for (const [i, s] of sessions.entries()) rocks.connect(id, s.playerId, String(i), true);
    for (const s of sessions)
      rocks.command(id, s.playerId, {
        id: randomUUID(),
        roundId: rocks.snapshot(id).roundId,
        type: "ready",
      });
    for (let seq = 0; seq < 100 && rocks.snapshot(id).phase !== "complete"; seq++) {
      now = 4000 + seq * 100;
      rocks.move(id, sessions[1].playerId, {
        roundId: rocks.snapshot(id).roundId,
        seq,
        dx: -1,
        jumpSeq: 0,
      });
    }
    const view = bridge.view("quiz", event, players);
    assert.equal(view.snapshot.phase, "complete");
    assert.equal(view.session, null);
    assert.equal(view.points.find((p) => p.participantId === "c")!.points, Number.MAX_SAFE_INTEGER);
    assert.throws(() =>
      rocks.command(id, sessions[0].playerId, {
        id: randomUUID(),
        roundId: view.snapshot.roundId,
        type: "rematch",
      }),
    );
  } finally {
    for (const service of [moment, zone, shooting, floor, rocks]) service.onModuleDestroy();
  }
});
