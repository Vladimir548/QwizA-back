import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Socket } from "socket.io";
import { FirefightService } from "../src/minigames/firefight.service";
import {
  FirefightGateway,
  parseFirefightInput,
  parseFirefightCommand,
} from "../src/minigames/firefight.gateway";
import { TopicMinigamesService } from "../src/rooms/topic-minigames.service";
import { MomentService } from "../src/minigames/moment.service";
import { ZoneService } from "../src/minigames/zone.service";
import { ShootingService } from "../src/minigames/shooting.service";
import { FallingFloorService } from "../src/minigames/falling-floor.service";
import type { TopicMinigameEvent } from "@qwiza/minigames";
test("firefight enforces duel capacity, server cooldown, stop packets and authenticated reconnect", () => {
  const service = new FirefightService();
  let now = 1000;
  service.now = () => now;
  try {
    const a = service.create("Аня", { mode: "duel" }),
      b = service.join(a.roomId, "Макс");
    assert.throws(() => service.join(a.roomId, "Третий"));
    for (const [i, p] of [a, b].entries()) service.connect(a.roomId, p.playerId, String(i), true);
    for (const p of [a, b])
      service.command(a.roomId, p.playerId, {
        id: randomUUID(),
        roundId: service.snapshot(a.roomId).roundId,
        type: "ready",
      });
    now = 4000;
    const roundId = service.snapshot(a.roomId).roundId,
      gateway = new FirefightGateway(service),
      socket = { data: { roomId: a.roomId, playerId: a.playerId } } as unknown as Socket;
    gateway.input(socket, { roundId, seq: 1, dx: 0, dy: 0, aimX: 1, aimY: 0, fire: true });
    assert.equal(service.snapshot(a.roomId).bullets.length, 1);
    socket.data.lastFirefightInput = performance.now() + 1000;
    now = 4010;
    gateway.input(socket, { roundId, seq: 2, dx: 0, dy: 0, aimX: 1, aimY: 0, fire: false });
    assert.equal(service.snapshot(a.roomId).players[0].inputSeq, 2);
    now = 4600;
    assert.equal(service.snapshot(a.roomId).players[1].hp, 9);
    service.connect(a.roomId, a.playerId, "0", false);
    service.connect(a.roomId, a.playerId, "back", true);
    assert.equal(service.snapshot(a.roomId).roundId, roundId);
    assert.equal(service.snapshot(a.roomId).players[1].hp, 9);
    assert.throws(() => service.authenticate(a.roomId, randomUUID()));
    service.seal(a.roomId);
    assert.throws(() => service.join(a.roomId, "Лишний"));
    const group = service.create("Первый", { mode: "group" });
    for (let i = 1; i < 12; i++) service.join(group.roomId, String(i));
    assert.throws(() => service.join(group.roomId, "13"));
  } finally {
    service.onModuleDestroy();
  }
});
test("transport rejects client HP, hit targets, projectile speed, invalid aim and clocks", () => {
  const input = { roundId: randomUUID(), seq: 1, dx: 1, dy: 1, aimX: 1, aimY: 0, fire: true };
  assert.deepEqual(parseFirefightInput(input), input);
  for (const bad of [
    { ...input, hp: 10 },
    { ...input, targetId: randomUUID() },
    { ...input, speed: 999 },
    { ...input, now: 1 },
    { ...input, fire: 1 },
    { ...input, aimX: 0, aimY: 0 },
    { ...input, aimY: NaN },
    { ...input, dx: 2 },
    { ...input, seq: -1 },
  ])
    assert.equal(parseFirefightInput(bad), null);
  assert.throws(() =>
    parseFirefightCommand({ id: randomUUID(), roundId: input.roundId, type: "win" }),
  );
});
test("group topic bridge creates all seats, hides credentials from spectators, and ranks eliminations", () => {
  const service = new FirefightService(),
    moment = new MomentService(),
    zone = new ZoneService(),
    shooting = new ShootingService(),
    floor = new FallingFloorService();
  let now = 1000;
  service.now = () => now;
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
      undefined,
      undefined,
      service,
    );
    const players = [
      { id: "a", name: "Аня" },
      { id: "b", name: "Макс" },
      { id: "c", name: "Ника" },
    ];
    const event: TopicMinigameEvent = {
      topicId: "firefight",
      title: "Тема",
      roundIndex: 0,
      prize: 1000,
      options: ["firefight"],
      selected: "firefight",
      participantIds: players.map((p) => p.id),
      voterIds: players.map((p) => p.id),
      votes: {},
    };
    const match = bridge.ensure("quiz", event, players),
      sessions = Object.values(match.sessions),
      id = sessions[0].roomId;
    for (const [i, s] of sessions.entries()) service.connect(id, s.playerId, String(i), true);
    for (const s of sessions)
      service.command(id, s.playerId, {
        id: randomUUID(),
        roundId: service.snapshot(id).roundId,
        type: "ready",
      });
    assert.equal(service.snapshot(id).mode, "group");
    assert.throws(() => service.join(id, "Лишний"));
    for (let seq = 1; seq < 160; seq++) {
      now = 4000 + seq * 100;
      const state = service.snapshot(id);
      if (state.phase === "complete") break;
      const self = state.players[0],
        target = state.players.slice(1).find((p) => p.alive)!;
      const dx = target.x - self.x,
        dy = target.y - self.y,
        length = Math.hypot(dx, dy);
      service.move(id, self.id, {
        roundId: state.roundId,
        seq,
        dx: 0,
        dy: 0,
        aimX: dx / length,
        aimY: dy / length,
        fire: true,
      });
    }
    const view = bridge.view("quiz", event, players);
    assert.equal(view.snapshot.phase, "complete");
    assert.equal(view.session, null);
    assert.equal(JSON.stringify(view.snapshot).includes('"token"'), false);
    assert.equal(view.points.find((p) => p.participantId === "a")!.points, Number.MAX_SAFE_INTEGER);
    assert.ok(
      view.points.find((p) => p.participantId === "c")!.points >
        view.points.find((p) => p.participantId === "b")!.points,
    );
    assert.throws(() =>
      service.command(id, sessions[0].playerId, {
        id: randomUUID(),
        roundId: view.snapshot.roundId,
        type: "rematch",
      }),
    );
  } finally {
    for (const s of [service, moment, zone, shooting, floor]) s.onModuleDestroy();
  }
});
