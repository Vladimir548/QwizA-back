import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ShellGameService } from "../src/minigames/shell-game.service";
import { parseShellCommand } from "../src/minigames/shell-game.gateway";
import { TopicMinigamesService } from "../src/rooms/topic-minigames.service";
import { MomentService } from "../src/minigames/moment.service";
import { ZoneService } from "../src/minigames/zone.service";
import { ShootingService } from "../src/minigames/shooting.service";
import { FallingFloorService } from "../src/minigames/falling-floor.service";
import { awardTopicPrizes, type ShellCommand, type TopicMinigameEvent } from "@qwiza/minigames";
class TestShells extends ShellGameService {
  protected randomIndex = () => 0;
}
test("shell transport rejects forged outcomes and only accepts three valid slots", () => {
  const envelope = { id: randomUUID(), roundId: randomUUID(), type: "choose", slot: 1 };
  assert.deepEqual(parseShellCommand(envelope), envelope);
  for (const bad of [
    { ...envelope, slot: -1 },
    { ...envelope, slot: 3 },
    { ...envelope, slot: 0.5 },
    { ...envelope, coinCup: 1 },
    { ...envelope, correct: true },
    { ...envelope, now: 0 },
    { ...envelope, type: "ready" },
    { ...envelope, slot: undefined },
    { ...envelope, type: "win" },
  ])
    assert.throws(() => parseShellCommand(bad));
  assert.equal(
    parseShellCommand({ id: randomUUID(), roundId: randomUUID(), type: "rematch" }).type,
    "rematch",
  );
});
test("shell rooms enforce two-player capacity, private answers, clocks, reconnect, immutable choices and sealed rematches", () => {
  const service = new TestShells();
  let now = 1000;
  service.now = () => now;
  try {
    const a = service.create("Аня", { mode: "duel" }),
      b = service.join(a.roomId, "Макс"),
      id = a.roomId;
    assert.throws(() => service.join(id, "Третий"));
    for (const [i, p] of [a, b].entries()) service.connect(id, p.playerId, String(i), true);
    const send = (p: typeof a, type: ShellCommand["type"], slot?: number) =>
      service.command(id, p.playerId, {
        id: randomUUID(),
        roundId: service.snapshot(id).roundId,
        type,
        ...(slot === undefined ? {} : { slot }),
      });
    send(a, "ready");
    send(b, "ready");
    const coinCup = service.snapshot(id).coinSlot!;
    while (service.snapshot(id).phase !== "choosing") now = service.snapshot(id).deadline!;
    const choosing = service.snapshot(id),
      slot = choosing.order.indexOf(coinCup);
    assert.equal(choosing.coinSlot, null);
    assert.equal("coinCup" in choosing, false);
    send(a, "choose", slot);
    assert.equal(service.snapshot(id, a.playerId).players[0].choice, slot);
    assert.equal(service.snapshot(id, b.playerId).players[0].choice, null);
    service.connect(id, a.playerId, "0", false);
    service.connect(id, a.playerId, "back", true);
    assert.equal(service.snapshot(id, a.playerId).players[0].choice, slot);
    assert.equal(service.snapshot(id).roundId, choosing.roundId);
    assert.throws(() => send(a, "choose", (slot + 1) % 3));
    send(b, "choose", (slot + 1) % 3);
    assert.equal(service.snapshot(id).phase, "revealing");
    now = service.snapshot(id).deadline!;
    assert.equal(service.snapshot(id).winnerId, a.playerId);
    service.seal(id);
    assert.throws(() => send(a, "rematch"));
    assert.throws(() => service.join(id, "Лишний"));
    assert.throws(() => service.authenticate(id, randomUUID()));
    const group = service.create("Первый", { mode: "group" });
    for (let i = 1; i < 12; i++) service.join(group.roomId, String(i));
    assert.throws(() => service.join(group.roomId, "13"));
  } finally {
    service.onModuleDestroy();
  }
});
test("shell topic bridge preserves survival order and shares places and prizes after a round without correct answers", () => {
  const shells = new TestShells(),
    moment = new MomentService(),
    zone = new ZoneService(),
    shooting = new ShootingService(),
    floor = new FallingFloorService();
  let now = 1000;
  shells.now = () => now;
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
      undefined,
      shells,
    );
    const players = [
      { id: "a", name: "Аня" },
      { id: "b", name: "Макс" },
      { id: "c", name: "Ника" },
      { id: "d", name: "Оля" },
      { id: "e", name: "Ира" },
      { id: "f", name: "Паша" },
    ];
    const event: TopicMinigameEvent = {
      topicId: "t",
      title: "Тема",
      roundIndex: 0,
      prize: 1000,
      options: ["shell-game"],
      selected: "shell-game",
      participantIds: players.map((p) => p.id),
      voterIds: players.map((p) => p.id),
      votes: {},
    };
    const match = bridge.ensure("quiz", event, players),
      sessions = Object.values(match.sessions),
      id = sessions[0].roomId;
    for (const [i, s] of sessions.entries()) shells.connect(id, s.playerId, String(i), true);
    for (const s of sessions)
      shells.command(id, s.playerId, {
        id: randomUUID(),
        roundId: shells.snapshot(id).roundId,
        type: "ready",
      });
    const start = shells.snapshot(id);
    const coin = start.order[start.coinSlot!];
    for (const correctCount of [5, 3, 2, 0]) {
      while (shells.snapshot(id).phase !== "choosing") now = shells.snapshot(id).deadline!;
      const snapshot = shells.snapshot(id);
      const slot = snapshot.order.indexOf(coin);
      snapshot.players.forEach((player, index) => {
        if (!player.alive) return;
        shells.command(id, player.id, {
          id: randomUUID(),
          roundId: snapshot.roundId,
          type: "choose",
          slot: index < correctCount ? slot : (slot + 1) % 3,
        });
      });
      now = shells.snapshot(id).deadline!;
    }
    const view = bridge.view("quiz", event, players);
    assert.equal(view.session, null);
    assert.equal(view.snapshot.phase, "complete");
    assert.equal(JSON.stringify(view.snapshot).includes('"token"'), false);
    assert.equal(shells.snapshot(id).mode, "group");
    const standings = awardTopicPrizes(
      players.map(({ id, name }) => ({
        id,
        name,
        points: view.points.find((p) => p.participantId === id)!.points,
      })),
      event.prize,
      "shell-game",
    );
    assert.deepEqual(
      standings.map((p) => p.place),
      [1, 1, 2, 3, 3, 4],
    );
    assert.deepEqual(
      standings.map((p) => p.prize),
      [250, 250, 300, 100, 100, 0],
    );
    assert.equal(bridge.view("quiz", event, players, "a").session!.playerId, sessions[0].playerId);
    assert.throws(() => shells.join(id, "Лишний"));
  } finally {
    for (const s of [shells, moment, zone, shooting, floor]) s.onModuleDestroy();
  }
});
