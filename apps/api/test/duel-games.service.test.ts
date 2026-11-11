import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { duelMinigames, type DuelEvent } from "@qwiza/minigames";
import { TopicMinigamesService } from "../src/rooms/topic-minigames.service";
import { MomentService } from "../src/minigames/moment.service";
import { ZoneService } from "../src/minigames/zone.service";
import { ShootingService } from "../src/minigames/shooting.service";
import { FallingFloorService } from "../src/minigames/falling-floor.service";
import { MemoryService } from "../src/minigames/memory.service";
import { HockeyService } from "../src/minigames/hockey.service";
import { TwentyOneService } from "../src/minigames/twenty-one.service";
import { NumberHuntService } from "../src/minigames/number-hunt.service";
import { DoubleBluffService } from "../src/minigames/double-bluff.service";
import { FirefightService } from "../src/minigames/firefight.service";

test("every catalog duel creates one sealed two-player match, restores each private seat and admits spectators without credentials", () => {
  const moment = new MomentService(),
    zone = new ZoneService(),
    shooting = new ShootingService(),
    floor = new FallingFloorService(),
    memory = new MemoryService(),
    hockey = new HockeyService(),
    cards = new TwentyOneService(),
    numbers = new NumberHuntService(),
    bluff = new DoubleBluffService(),
    firefight = new FirefightService();
  const bridge = new TopicMinigamesService(
    moment,
    zone,
    shooting,
    floor,
    memory,
    hockey,
    cards,
    numbers,
    undefined,
    undefined,
    bluff,
    firefight,
  );
  const services = {
    memory,
    hockey,
    "twenty-one": cards,
    "number-hunt": numbers,
    "double-bluff": bluff,
    firefight,
  };
  const players = [
    { id: "a", name: "Аня" },
    { id: "b", name: "Ника" },
    { id: "c", name: "Зритель" },
  ];
  try {
    for (const kind of duelMinigames()) {
      const event: DuelEvent = {
        id: kind,
        challengerId: "a",
        opponentId: "b",
        kind,
        stake: 100,
        phase: "playing",
      };
      const a = bridge.duelView("quiz", event, players, "a");
      const b = bridge.duelView("quiz", event, players, "b");
      assert.equal(a.session!.roomId, b.session!.roomId);
      assert.notEqual(a.session!.token, b.session!.token);
      assert.deepEqual(bridge.duelView("quiz", event, players, "a").session, a.session);
      const spectator = bridge.duelView("quiz", event, players, "c");
      assert.equal(spectator.session, null);
      assert.equal(spectator.snapshot.players.length, 2);
      assert.equal(JSON.stringify(spectator.snapshot).includes('"token"'), false);
      assert.throws(() => services[kind].join(a.session!.roomId, "Лишний"));
    }
  } finally {
    for (const service of [moment, zone, shooting, floor, ...Object.values(services)])
      service.onModuleDestroy();
  }
});
