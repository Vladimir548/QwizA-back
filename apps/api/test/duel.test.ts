import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRoomDuel } from "../src/rooms/room-duels";
import { rewardCorrectAnswer } from "../src/rooms/bonus-rewards";
import type { PrivateRoomState, RoomResponse } from "../src/rooms/rooms.types";
const initial = (): PrivateRoomState => ({
  phase: "board",
  played: [],
  buzzCandidates: [],
  responses: [],
  powersEnabled: true,
  correctAnswers: { a: 4 },
  duelChallenges: {},
});
const players = [
  { id: "a", name: "А", score: 8000 },
  { id: "b", name: "Б", score: 5000 },
  { id: "c", name: "В", score: 9000 },
];
test("server reward cycles do not stack challenges or mix them into random rewards", () => {
  const state = initial();
  const response: RoomResponse = {
    participantId: "a",
    answer: "Да",
    correct: true,
    scoreDelta: 100,
  };
  rewardCorrectAnswer(state, response);
  assert.equal(state.duelChallenges?.a, true);
  for (let i = 0; i < 5; i++) rewardCorrectAnswer(state, response);
  assert.equal(state.correctAnswers?.a, 10);
  assert.equal(state.duelChallenges?.a, true);
  state.duelChallenges!.a = false;
  for (let i = 0; i < 4; i++) {
    rewardCorrectAnswer(state, response);
    assert.equal(state.duelChallenges?.a, false);
  }
  rewardCorrectAnswer(state, response);
  assert.equal(state.duelChallenges?.a, true);
  assert.ok(["double", "shield", "freeze"].includes(response.awardedPower!));
  assert.deepEqual(Object.keys(state.powersByPlayer!.a).sort(), ["double", "freeze", "shield"]);
});
test("only the invited player can accept; declines and stale commands cannot consume a challenge", () => {
  const s = initial();
  s.duelChallenges = { a: true };
  const a = { id: "a", role: "player" },
    b = { id: "b", role: "player" };
  const offer = {
    type: "offer-duel" as const,
    id: "d",
    minigame: "hockey",
    targetParticipantId: "b",
    stake: 1500,
  };
  assert.throws(() => applyRoomDuel(s, { ...offer, minigame: "zone" }, a, players, false));
  assert.throws(() => applyRoomDuel(s, offer, a, players, true));
  applyRoomDuel(s, offer, a, players, false);
  assert.equal(s.duelChallenges.a, true);
  const accept = { id: "accept", type: "accept-duel" as const, duelId: "d" };
  for (const actor of [a, { id: "c", role: "host" }, { id: "c", role: "player" }])
    assert.throws(() => applyRoomDuel(s, accept, actor, players, false));
  assert.throws(() => applyRoomDuel(s, { ...accept, duelId: "old" }, b, players, false));
  applyRoomDuel(s, { ...accept, type: "decline-duel" }, b, players, false);
  assert.equal(s.duelChallenges.a, true);
  assert.equal(s.duel, undefined);
  applyRoomDuel(s, offer, a, players, false);
  applyRoomDuel(s, accept, b, players, false);
  assert.equal(s.duelChallenges.a, false);
  assert.equal(s.phase, "duel");
  assert.throws(() => applyRoomDuel(s, accept, b, players, false));
});
