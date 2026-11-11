import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { validateSync } from "class-validator";
import type { Socket } from "socket.io";
import type { FallingFloorCommand } from "@qwiza/minigames";
import { FallingFloorService } from "../src/minigames/falling-floor.service";
import {
  parseFallingFloorCommand,
  parseFallingFloorInput,
  FallingFloorGateway,
} from "../src/minigames/falling-floor.gateway";
import { JoinMinigameDto } from "../src/minigames/moment.dto";

class TestFallingFloorService extends FallingFloorService {
  protected randomIndex = () => 0;
}

test("gateway accepts an immediate stop after movement without coasting while throttling repeated input bursts", () => {
  const { service, sessions, snapshot, ready, at, id } = room();
  try {
    const gateway = new FallingFloorGateway(service);
    const socket = { data: { roomId: id, playerId: sessions[0].playerId } } as unknown as Socket;
    ready();
    at(4000);
    const roundId = snapshot().roundId;
    gateway.input(socket, { roundId, seq: 0, dx: 1, dy: 0 });
    assert.equal(snapshot().players[0].inputSeq, 0);
    assert.equal(socket.data.fallingFloorMoving, true);

    // A future rate-limit marker guarantees the next packet is inside the window without sleeping.
    socket.data.lastFallingFloorInput = performance.now() + 1000;
    at(4010);
    gateway.input(socket, { roundId, seq: 1, dx: 0, dy: 0 });
    assert.equal(snapshot().players[0].inputSeq, 1);
    assert.equal(socket.data.fallingFloorMoving, false);
    const stoppedX = snapshot().players[0].x;
    assert.ok(Math.abs(stoppedX - 2.53) < 1e-8);
    at(4200);
    assert.equal(snapshot().players[0].x, stoppedX);

    socket.data.lastFallingFloorInput = performance.now() + 1000;
    gateway.input(socket, { roundId, seq: 2, dx: 0, dy: 0 });
    gateway.input(socket, { roundId, seq: 3, dx: 1, dy: 0 });
    assert.equal(snapshot().players[0].inputSeq, 1);
    assert.equal(socket.data.fallingFloorMoving, false);

    socket.data.lastFallingFloorInput = -Infinity;
    gateway.input(socket, { roundId, seq: 3, dx: 1, dy: 0 });
    assert.equal(snapshot().players[0].inputSeq, 3);
    assert.equal(socket.data.fallingFloorMoving, true);
    socket.data.lastFallingFloorInput = performance.now() + 1000;
    const rateMarker = socket.data.lastFallingFloorInput;
    gateway.input(socket, { roundId, seq: 4, dx: 0, dy: 0, x: 7 });
    assert.equal(socket.data.lastFallingFloorInput, rateMarker);
    assert.equal(socket.data.fallingFloorMoving, true);

    // Stale round/sequence packets cannot stop movement or consume its transition state.
    for (const input of [
      { roundId, seq: 2, dx: 0, dy: 0 },
      { roundId: randomUUID(), seq: 4, dx: 0, dy: 0 },
    ]) {
      socket.data.lastFallingFloorInput = -Infinity;
      gateway.input(socket, input);
      assert.equal(snapshot().players[0].inputSeq, 3);
      assert.equal(socket.data.fallingFloorMoving, true);
    }

    // Rejected stop attempts have their own rate bound and cannot bypass it in a flood.
    socket.data.lastFallingFloorInput = performance.now() + 1000;
    socket.data.lastFallingFloorStopAttempt = performance.now() + 1000;
    gateway.input(socket, { roundId, seq: 5, dx: 0, dy: 0 });
    assert.equal(snapshot().players[0].inputSeq, 3);
    socket.data.lastFallingFloorStopAttempt = -Infinity;
    gateway.input(socket, { roundId, seq: 5, dx: 0, dy: 0 });
    assert.equal(snapshot().players[0].inputSeq, 5);
    assert.equal(socket.data.fallingFloorMoving, false);
  } finally {
    service.onModuleDestroy();
  }
});
function room(count = 2) {
  const service = new TestFallingFloorService();
  let now = 1000;
  service.now = () => now;
  const first = service.create("Аня", undefined);
  const sessions = [first];
  for (let index = 1; index < count; index++)
    sessions.push(service.join(first.roomId, `Игрок ${index}`));
  for (const [index, session] of sessions.entries())
    service.connect(first.roomId, session.playerId, `socket${index}`, true);
  const snapshot = () => service.snapshot(first.roomId);
  const send = (index: number, type: FallingFloorCommand["type"]) =>
    service.command(first.roomId, sessions[index].playerId, {
      id: randomUUID(),
      roundId: snapshot().roundId,
      type,
    });
  const ready = () => {
    for (let index = 0; index < sessions.length; index++) send(index, "ready");
  };
  const at = (time: number) => {
    now = time;
  };
  const move = (index: number, seq: number, dx: number, dy: number, roundId = snapshot().roundId) =>
    service.move(first.roomId, sessions[index].playerId, { roundId, seq, dx, dy });
  return { service, sessions, snapshot, send, ready, at, move, id: first.roomId };
}

test("rooms authenticate seats, deduplicate ready, enforce cap twelve and cancel countdown after disconnect", () => {
  const { service, sessions, snapshot, send, ready, at, id } = room(2);
  try {
    assert.equal(service.authenticate(id, sessions[0].token), sessions[0].playerId);
    assert.throws(() => service.authenticate(id, randomUUID()));
    const command: FallingFloorCommand = {
      id: randomUUID(),
      roundId: snapshot().roundId,
      type: "ready",
    };
    service.command(id, sessions[0].playerId, command);
    service.command(id, sessions[0].playerId, command);
    assert.equal(snapshot().phase, "lobby");
    sessions.push(service.join(id, "Ника"));
    assert.ok(snapshot().players.every((player) => !player.ready));
    assert.throws(() => send(0, "ready"));
    for (let index = 3; index < 12; index++) sessions.push(service.join(id, `Игрок ${index}`));
    assert.throws(() => service.join(id, "Тринадцатый"));
    for (let index = 2; index < 12; index++)
      service.connect(id, sessions[index].playerId, `socket${index}`, true);
    ready();
    assert.equal(snapshot().phase, "countdown");
    assert.throws(() => service.join(id, "Поздний"));
    at(2000);
    service.connect(id, sessions[5].playerId, "socket5", false);
    assert.equal(snapshot().phase, "lobby");
    assert.ok(snapshot().players.every((player) => !player.ready));
    service.connect(id, sessions[5].playerId, "new5", true);
    ready();
    at(5000);
    assert.equal(snapshot().phase, "running");
    assert.equal(snapshot().players.length, 12);
  } finally {
    service.onModuleDestroy();
  }
});

test("movement trusts directions only, normalizes speed, ignores stale inputs and stops disconnected players", () => {
  const { service, sessions, snapshot, ready, at, move, id } = room();
  try {
    ready();
    const roundId = snapshot().roundId;
    at(2000);
    move(0, 0, 1, 0);
    assert.equal(snapshot().players[0].inputSeq, -1);
    at(4000);
    assert.equal(snapshot().phase, "running");
    move(0, 0, 1, 1);
    at(4100);
    const moved = snapshot().players[0];
    assert.ok(Math.abs(Math.hypot(moved.x - 2.5, moved.y - 2.5) - 0.3) < 1e-8);
    move(0, 0, -1, 0);
    move(0, 1, 1, 0, randomUUID());
    assert.equal(snapshot().players[0].inputSeq, 0);
    service.connect(id, sessions[0].playerId, "socket0", false);
    at(5000);
    assert.equal(snapshot().players[0].x, moved.x);
    assert.equal(snapshot().players[0].y, moved.y);
    move(0, 1, -1, 0);
    assert.equal(snapshot().players[0].inputSeq, 0);
    service.connect(id, sessions[0].playerId, "new0", true);
    assert.equal(snapshot().players[0].alive, true);
    move(0, 1, 1, 0, roundId);
    at(6000);
    assert.ok(Math.abs(snapshot().players[0].x - moved.x - 0.75) < 1e-8);
    assert.equal(snapshot().players[0].inputSeq, 1);
    assert.equal("inputs" in snapshot(), false);
    assert.equal("simulatedAt" in snapshot(), false);
    assert.equal(JSON.stringify(snapshot()).includes(sessions[0].token), false);
  } finally {
    service.onModuleDestroy();
  }
});

test("server warnings collapse after two seconds, idle disconnected players fall and mutual rematch preserves wins", () => {
  const { service, sessions, snapshot, ready, send, at, move, id } = room();
  try {
    ready();
    at(4000);
    snapshot();
    for (let seq = 0; seq < 4; seq++) {
      at(4000 + seq * 200);
      move(0, seq, 0, -1);
    }
    at(4700);
    move(0, 4, 0, 0);
    assert.ok(snapshot().players[0].y < 1);
    service.connect(id, sessions[0].playerId, "socket0", false);
    at(8999);
    assert.ok(snapshot().tiles.every((tile) => tile.state === "safe"));
    at(9000);
    const warning = snapshot();
    assert.equal(warning.wave, 1);
    assert.equal(warning.tiles.filter((tile) => tile.state === "warning").length, 12);
    assert.ok(
      warning.tiles
        .filter((tile) => tile.state === "warning")
        .every((tile) => tile.fallsAt === 11000),
    );
    at(10999);
    assert.equal(snapshot().players[0].alive, true);
    at(11000);
    const result = snapshot();
    assert.equal(result.phase, "complete");
    assert.deepEqual(result.winnerIds, [sessions[1].playerId]);
    assert.equal(result.players[0].eliminatedAt, 11000);
    assert.equal(result.players[1].score, 1);
    const oldRound = result.roundId;
    at(20000);
    assert.equal(snapshot().players[1].score, 1);
    assert.throws(() => send(1, "rematch"));
    service.connect(id, sessions[0].playerId, "new0", true);
    assert.equal(snapshot().players[0].alive, false);
    send(0, "rematch");
    assert.equal(snapshot().phase, "complete");
    send(1, "rematch");
    const rematch = snapshot();
    assert.equal(rematch.phase, "countdown");
    assert.notEqual(rematch.roundId, oldRound);
    assert.equal(rematch.matchNumber, 2);
    assert.equal(rematch.players[1].score, 1);
    assert.ok(rematch.players.every((player) => player.alive && player.inputSeq === -1));
    assert.ok(rematch.tiles.every((tile) => tile.state === "safe"));
    at(23000);
    move(0, 100, 1, 0, oldRound);
    assert.equal(snapshot().players[0].inputSeq, -1);
  } finally {
    service.onModuleDestroy();
  }
});

test("server snapshots include collision movement for an opponent who sent no input", () => {
  const { service, snapshot, ready, at, move } = room();
  try {
    ready();
    for (let seq = 0; seq < 5; seq++) {
      at(4000 + seq * 200);
      move(0, seq, 0, 1);
    }
    at(5000);
    move(0, 5, 1, 0);
    for (let seq = 6; seq < 11; seq++) {
      at(5000 + (seq - 5) * 200);
      move(0, seq, 1, 0);
    }
    const view = snapshot();
    assert.ok(view.players[1].x > 5.55);
    assert.equal(view.players[1].inputSeq, -1);
    assert.ok(view.players.every((player) => player.alive));
    assert.equal("knockbacks" in view, false);
    assert.ok(view.players[1].x - view.players[0].x >= 0.639);
  } finally {
    service.onModuleDestroy();
  }
});

test("stream and command parsers reject client positions, clocks, scores, invalid vectors and unknown properties", () => {
  const base = { id: randomUUID(), roundId: randomUUID(), type: "ready" };
  assert.deepEqual(parseFallingFloorCommand(base), base);
  assert.deepEqual(parseFallingFloorCommand({ ...base, type: "rematch" }), {
    ...base,
    type: "rematch",
  });
  for (const input of [
    null,
    {},
    { ...base, type: "win" },
    { ...base, score: 99 },
    { ...base, playerId: randomUUID() },
    { ...base, x: 7 },
    { ...base, dx: 1 },
  ])
    assert.throws(() => parseFallingFloorCommand(input));
  const valid = { roundId: randomUUID(), seq: 0, dx: 1, dy: -1 };
  assert.deepEqual(parseFallingFloorInput(valid), valid);
  for (const input of [
    null,
    {},
    { ...valid, seq: -1 },
    { ...valid, seq: 1.5 },
    { ...valid, seq: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, roundId: "old" },
    { ...valid, dx: 1.1 },
    { ...valid, dy: -1.1 },
    { ...valid, dx: Infinity },
    { ...valid, dy: NaN },
    { ...valid, x: 3 },
    { ...valid, y: 3 },
    { ...valid, now: 99999 },
    { ...valid, alive: true },
    { ...valid, speed: 99 },
    { ...valid, score: 99 },
  ])
    assert.equal(parseFallingFloorInput(input), null);
  assert.equal(
    validateSync(Object.assign(new JoinMinigameDto(), { displayName: "Аня" }), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }).length,
    0,
  );
  for (const extra of [{ playerCount: 6 }, { settings: {} }, { speed: 99 }])
    assert.ok(
      validateSync(Object.assign(new JoinMinigameDto(), { displayName: "Аня", ...extra }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).length > 0,
    );
});
