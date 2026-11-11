import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eligibleHostBuzzPlayers,
  pauseHostBuzzer,
  resumeHostBuzzer,
} from "../src/rooms/host-buzzer";
import type { PrivateRoomState } from "../src/rooms/rooms.types";

const players = ["a", "b", "c"].map((id) => ({ id, role: "player" }));
test("host retries close when everyone has answered, skipped or is frozen", () => {
  const state: PrivateRoomState = {
    hostEnabled: true,
    phase: "review",
    played: [],
    buzzCandidates: [],
    buzzRemainingMs: 17500,
    skippedPlayers: ["b"],
    frozenPlayerId: "c",
    responses: [
      { participantId: "a", answer: "Нет", judged: true, correct: false, scoreDelta: -100 },
    ],
  };
  assert.deepEqual(eligibleHostBuzzPlayers(state, players), []);
  assert.equal(resumeHostBuzzer(state, players, 100000), false);
  state.skippedPlayers = [];
  state.buzzRemainingMs = 0;
  assert.equal(resumeHostBuzzer(state, players, 100000), false);
});
test("pausing is idempotent and never affects an automatic game", () => {
  const state: PrivateRoomState = {
    phase: "question",
    played: [],
    buzzCandidates: [],
    responses: [],
    deadlineAt: 30000,
  };
  pauseHostBuzzer(state, 1000);
  assert.equal(state.deadlineAt, 30000);
  state.hostEnabled = true;
  pauseHostBuzzer(state, 2100);
  pauseHostBuzzer(state, 9000);
  assert.equal(state.buzzRemainingMs, 27900);
  assert.equal(state.deadlineAt, undefined);
  assert.equal(resumeHostBuzzer(state, players, 50000), true);
  assert.equal(state.deadlineAt, 77900);
  assert.equal(state.buzzOpensAt, 50000);
});

test("disabled rebuzz and rooms without a host cannot resume the buzzer", () => {
  const state: PrivateRoomState = {
    phase: "review",
    played: [],
    buzzCandidates: [],
    responses: [],
    hostEnabled: true,
    hostRebuzzEnabled: false,
    buzzRemainingMs: 17500,
  };
  assert.equal(resumeHostBuzzer(state, players, 1000), false);
  assert.equal(state.phase, "review");
  assert.equal(state.buzzRemainingMs, 17500);
  state.hostEnabled = false;
  state.hostRebuzzEnabled = true;
  assert.equal(resumeHostBuzzer(state, players, 1000), false);
});
