import assert from "node:assert/strict";
import { test } from "node:test";
import { openTopicMinigameVote } from "../src/rooms/topic-minigame-vote";
import type { PrivateRoomState, RoomPack } from "../src/rooms/rooms.types";
const pack = {
  topics: [
    {
      id: "topic",
      title: "Тема",
      questions: [
        { id: "a", value: 500 },
        { id: "b", value: 500 },
      ],
    },
  ],
} as RoomPack;
const players = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
const state = (): PrivateRoomState => ({
  phase: "result",
  currentQuestionId: "b",
  played: ["a", "b"],
  answeredQuestions: ["a", "b"],
  buzzCandidates: [],
  responses: [],
});
test("only a topic with every question answered opens a single vote, including the last topic", () => {
  const room = state();
  assert.equal(openTopicMinigameVote(room, pack, players, false), true);
  assert.equal(room.topicEvent?.prize, 1000);
  assert.deepEqual(room.topicEvent?.options, [
    "moment",
    "zone",
    "shooting",
    "falling-floor",
    "sequence",
    "rockfall",
    "firefight",
  ]);
  assert.deepEqual(
    room.topicEvent?.voterIds,
    players.map((p) => p.id),
  );
  assert.equal(openTopicMinigameVote(room, pack, players, false), false);
});
test("closed but skipped or unanswered questions do not unlock a topic event", () => {
  const room = state();
  room.answeredQuestions = ["b"];
  assert.equal(openTopicMinigameVote(room, pack, players, false), false);
  room.answeredQuestions = [];
  assert.equal(openTopicMinigameVote(room, pack, players, false), false);
});

for (const teams of [false, true])
  test(`disabled topic minigames never open a vote (${teams ? "teams" : "solo"})`, () => {
    const room = { ...state(), topicMinigamesEnabled: false, powersEnabled: true };
    assert.equal(openTopicMinigameVote(room, pack, players, teams), false);
    assert.equal(room.topicEvent, undefined);
    assert.equal(room.handledTopicIds, undefined);
    assert.equal(room.powersEnabled, true);
  });
