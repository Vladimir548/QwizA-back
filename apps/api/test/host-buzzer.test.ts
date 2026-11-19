import assert from "node:assert/strict";
import { test } from "node:test";
import { eligibleBuzzPlayers, pauseBuzzClock, resumeBuzzer } from "../src/rooms/host-buzzer";
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
  assert.deepEqual(eligibleBuzzPlayers(state, players), []);
  assert.equal(resumeBuzzer(state, players, 100000), false);
  state.skippedPlayers = [];
  state.buzzRemainingMs = 0;
  assert.equal(resumeBuzzer(state, players, 100000), false);
});
test("pausing captures the remaining clock only once and leaves disabled automatic games running", () => {
  const state: PrivateRoomState = {
    phase: "question",
    played: [],
    buzzCandidates: [],
    responses: [],
    hostRebuzzEnabled: false,
    bonusOpensAt: 500,
    deadlineAt: 30000,
  };
  pauseBuzzClock(state, 1000);
  assert.equal(state.deadlineAt, 30000);
  state.hostEnabled = true;
  state.hostRebuzzEnabled = true;
  pauseBuzzClock(state, 2100);
  pauseBuzzClock(state, 9000);
  assert.equal(state.buzzRemainingMs, 27900);
  assert.equal(state.deadlineAt, undefined);
  assert.equal(resumeBuzzer(state, players, 50000), true);
  assert.equal(state.deadlineAt, 78900);
  assert.equal(state.buzzOpensAt, 51000);
  assert.equal(state.bonusOpensAt, undefined);
});

test("automatic rebuzz restores the captured clock and excludes players whose answers were graded automatically", () => {
  const state: PrivateRoomState = {
    phase: "review",
    played: [],
    buzzCandidates: [],
    responses: [],
    hostEnabled: true,
    hostRebuzzEnabled: false,
    buzzRemainingMs: 17500,
  };
  assert.equal(resumeBuzzer(state, players, 1000), false);
  assert.equal(state.phase, "review");
  assert.equal(state.buzzRemainingMs, 17500);
  state.hostEnabled = false;
  state.hostRebuzzEnabled = true;
  state.responses.push({ participantId: "a", answer: "Нет", correct: false, scoreDelta: -100 });
  assert.deepEqual(
    eligibleBuzzPlayers(state, players).map((player) => player.id),
    ["b", "c"],
  );
  assert.equal(resumeBuzzer(state, players, 1000), true);
  assert.equal(state.deadlineAt, 19500);
  assert.equal(resumeBuzzer(state, players, 2000), false);
});
