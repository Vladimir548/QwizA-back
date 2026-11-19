import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addIceRacer,
  advanceIceRace,
  applyIceRaceCommand,
  applyIceRaceInput,
  createIceRace,
  ICE_RACE_DURATION_MS,
  iceRacePublicState,
} from "../src/ice-race";
import {
  crossesIceCheckpoint,
  ICE_CHECKPOINT_POINTS,
  iceCheckpoints,
  isOnIceTrack,
} from "../src/ice-track";

function race() {
  const match = createIceRace("lobby");
  for (const id of ["a", "b"]) {
    addIceRacer(match, id, id);
    match.players.at(-1)!.connected = true;
  }
  const command = (id: string, type: "ready" | "rematch", now: number) =>
    applyIceRaceCommand(match, id, { id, roundId: match.roundId, type }, now, type);
  command("a", "ready", 0);
  assert.equal(match.phase, "lobby");
  command("b", "ready", 0);
  let now = match.startsAt!;
  let seq = 0;
  advanceIceRace(match, now);
  function drive(ms: number, dx: number, dy: number) {
    const end = now + ms;
    for (; now < end; now += 40) {
      assert.ok(applyIceRaceInput(match, "a", { roundId: match.roundId, seq: seq++, dx, dy }, now));
      advanceIceRace(match, now + 40);
    }
  }
  return { match, player: match.players[0], drive, command, now: () => now };
}

test("the gate counts only a forward crossing on the ice", () => {
  const gate = iceCheckpoints[0];
  const from = { x: gate.x, y: gate.y + 5 },
    to = { x: gate.x, y: gate.y - 5 };
  assert.ok(isOnIceTrack(from) && isOnIceTrack(to));
  assert.equal(crossesIceCheckpoint(from, to, 0), true);
  assert.equal(crossesIceCheckpoint(to, from, 0), false);
  assert.equal(crossesIceCheckpoint(from, to, 1), false);
  assert.equal(
    crossesIceCheckpoint({ ...from, x: gate.x + 55 }, { ...to, x: gate.x + 55 }, 0),
    false,
  );
});

test("release leaves momentum, a missed turn returns to the last gate and points remain", () => {
  const { match, player, drive } = race();
  drive(800, 0, -1);
  assert.equal(player.points, ICE_CHECKPOINT_POINTS);
  assert.equal(player.nextCheckpoint, 1);
  const y = player.y;
  drive(120, 0, 0);
  assert.ok(player.y < y - 10);
  drive(520, 0, -1);
  assert.ok(player.respawnAt !== null);
  assert.equal(player.points, ICE_CHECKPOINT_POINTS);
  advanceIceRace(match, player.respawnAt! + 20);
  assert.equal(player.respawnAt, null);
  assert.equal(player.y, iceCheckpoints[0].y);
  assert.equal(player.nextCheckpoint, 1);
});

test("a collision pushes a stationary racer who keeps sliding on ice", () => {
  const { match, player, drive, now } = race();
  const opponent = match.players[1];
  Object.assign(player, { x: 130, y: 345 });
  Object.assign(opponent, { x: 130, y: 310 });

  drive(360, 0, -1);

  assert.ok(opponent.y < 310);
  assert.ok(opponent.speed > 0);
  assert.ok(player.y - opponent.y >= 20);

  const pushedY = opponent.y;
  advanceIceRace(match, now() + 120);
  assert.ok(opponent.y < pushedY);
});

test("a racer pushed off the edge returns to their checkpoint with their points", () => {
  const { match, player, drive } = race();
  const opponent = match.players[1];
  Object.assign(player, { x: 151, y: 330 });
  Object.assign(opponent, {
    x: 170,
    y: 330,
    points: ICE_CHECKPOINT_POINTS,
    nextCheckpoint: 1,
  });

  drive(240, 1, 0);

  assert.ok(opponent.respawnAt !== null);
  advanceIceRace(match, opponent.respawnAt + 20);
  assert.equal(opponent.respawnAt, null);
  assert.equal(opponent.x, iceCheckpoints[0].x);
  assert.equal(opponent.y, iceCheckpoints[0].y);
  assert.equal(opponent.points, ICE_CHECKPOINT_POINTS);
  assert.equal(opponent.nextCheckpoint, 1);
});

test("rankings use gate points at the deadline, and a rematch resets progress while retaining wins", () => {
  const { match, drive, command, now, player } = race();
  assert.equal(match.endsAt! - match.startsAt!, ICE_RACE_DURATION_MS);
  const input = { roundId: match.roundId, seq: 5, dx: 0, dy: -1 };
  assert.equal(applyIceRaceInput(match, "a", { ...input, roundId: "old" }, now()), false);
  assert.equal(applyIceRaceInput(match, "a", { ...input, dx: 2 }, now()), false);
  drive(800, 0, -1);
  assert.equal(applyIceRaceInput(match, "a", input, now()), false);
  advanceIceRace(match, match.endsAt!);
  assert.deepEqual(match.winnerIds, ["a"]);
  assert.equal(match.phase, "complete");
  assert.equal(player.score, 1);
  assert.ok(!("motion" in iceRacePublicState(match)));
  assert.equal(applyIceRaceInput(match, "a", { ...input, seq: 100 }, match.endsAt!), false);
  command("a", "rematch", 50000);
  command("b", "rematch", 50000);
  assert.equal(match.phase, "countdown");
  assert.equal(player.points, 0);
  assert.equal(player.score, 1);
  assert.equal(match.matchNumber, 2);
});

test("racers with equal scores share first place", () => {
  const { match } = race();
  advanceIceRace(match, match.endsAt!);
  assert.deepEqual(match.winnerIds, ["a", "b"]);
});
