import assert from "node:assert/strict";
import { test } from "node:test";
import { skipRoomTopic } from "../src/rooms/topic-skipping";
import { activeRound } from "../src/rooms/rooms.service";
import type { PrivateRoomState, RoomPack } from "../src/rooms/rooms.types";

const question = {
  id: "q1",
  type: "text" as const,
  answerMode: "buzzer" as const,
  answerTimeSeconds: 30,
  value: 100,
  prompt: "Вопрос",
  options: [],
  answer: "Ответ",
  acceptedAnswers: [],
};
const pack: RoomPack = {
  id: "pack",
  title: "Пак",
  rounds: ["Первый", "Второй"],
  topics: [
    { id: "topic", title: "Тема", questions: [question, { ...question, id: "q2" }] },
    { id: "future", title: "Будущая", roundIndex: 1, questions: [{ ...question, id: "q3" }] },
  ],
};
const initial = (): PrivateRoomState => ({
  phase: "board",
  played: ["q1"],
  buzzCandidates: [],
  responses: [],
  pickerId: "a",
});
const player = (id: string) => ({ id, role: "player" as const });

test("room topic skipping needs every individual player, including disconnected players and teammates", () => {
  const state = initial();
  const ids = ["a", "b", "c", "d", "offline"];
  const vote = (id: string) => skipRoomTopic(state, pack, 0, "topic", player(id), ids, false, 1000);
  assert.ok(vote("outsider").error);
  for (const id of ids.slice(0, -1)) {
    assert.deepEqual(vote(id), {});
    assert.deepEqual(state.played, ["q1"]);
    assert.ok(vote(id).error);
  }
  assert.deepEqual(vote("offline"), { skipped: true });
  assert.deepEqual(state.played, ["q1", "q2"]);
  assert.deepEqual(state.responses, []);
  assert.deepEqual(state.topicSkipVotes, {});
  assert.equal(state.pickerId, "a");
  assert.equal(activeRound(pack, state), 1);
});

test("a creator/player cannot bypass host authority; only host skips immediately", () => {
  const state = initial();
  assert.ok(skipRoomTopic(state, pack, 0, "topic", player("a"), ["a", "b"], true, 1000).error);
  assert.deepEqual(state.played, ["q1"]);
  assert.deepEqual(
    skipRoomTopic(state, pack, 0, "topic", { id: "host", role: "host" }, ["a", "b"], true, 1000),
    { skipped: true },
  );
});

test("unavailable topics, wrong phases, host votes in hostless games and roulette cannot be bypassed", () => {
  const state = initial();
  const vote = (topicId = "topic", hasHost = false) =>
    skipRoomTopic(state, pack, 0, topicId, player("a"), ["a", "b"], hasHost, 1000);
  assert.ok(vote("future").error);
  assert.ok(vote("missing").error);
  assert.ok(
    skipRoomTopic(state, pack, 0, "topic", { id: "host", role: "host" }, ["a", "b"], false, 1000)
      .error,
  );
  state.pickerRouletteEndsAt = 2000;
  assert.ok(vote().error);
  state.pickerRouletteEndsAt = undefined;
  for (const phase of [
    "lobby",
    "loading",
    "presentation",
    "question",
    "review",
    "result",
  ] as const) {
    state.phase = phase;
    assert.ok(vote().error);
  }
  state.phase = "board";
  state.played.push("q2");
  assert.ok(vote().error);
  assert.equal(state.topicSkipVotes, undefined);
});
