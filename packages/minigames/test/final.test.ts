import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceFinal,
  createFinal,
  finalLeaders,
  publicFinal,
  type FinalTopic,
} from "../src/final";
const topics: FinalTopic[] = ["Картинка", "Математика", "Биология"].map((title, i) => ({
  id: String(i),
  title,
  question: {
    id: "q" + i,
    type: i === 1 ? "choice" : "text",
    prompt: "Скрытый вопрос",
    options: i === 1 ? ["2", "3"] : [],
    answer: i === 1 ? "2" : "ёж",
    acceptedAnswers: ["ежик"],
    answerTimeSeconds: 20,
  },
}));
const players = [
  { id: "a", name: "А", score: 100, memberIds: ["a", "ally"] },
  { id: "b", name: "Б", score: 0, memberIds: ["b"] },
];
const voting = () =>
  advanceFinal(createFinal(topics, players, 0), topics, null, { type: "tick" }, 4000, 0);
test("intro lasts four seconds and selected topic is revealed for two seconds before betting", () => {
  const intro = createFinal(topics, players, 0);
  assert.equal(intro.phase, "intro");
  assert.equal(intro.deadlineAt, 4000);
  assert.equal(advanceFinal(intro, topics, null, { type: "tick" }, 3999, 0), intro);
  let s = voting();
  assert.equal(s.phase, "vote");
  assert.equal(s.deadlineAt, 34000);
  s = advanceFinal(s, topics, "a", { type: "vote", topicId: "0" }, 4001, 0);
  s = advanceFinal(s, topics, "b", { type: "vote", topicId: "0" }, 4002, 0);
  assert.equal(s.phase, "reveal");
  assert.equal(s.deadlineAt, 6002);
  assert.equal(publicFinal(s, topics, null).question, undefined);
  assert.equal(advanceFinal(s, topics, null, { type: "tick" }, 6001, 0), s);
  s = advanceFinal(s, topics, null, { type: "tick" }, 6002, 0);
  assert.equal(s.phase, "bet");
  assert.equal(s.deadlineAt, 36002);
});
test("ties include only leaders and an empty vote includes every topic", () => {
  assert.deepEqual(finalLeaders(topics, { a: "0", b: "1" }), ["0", "1"]);
  assert.deepEqual(finalLeaders(topics, {}), ["0", "1", "2"]);
  let s = voting();
  s = advanceFinal(s, topics, "a", { type: "vote", topicId: "0" }, 4001, 0);
  s = advanceFinal(s, topics, "b", { type: "vote", topicId: "1" }, 4002, 0.99);
  assert.equal(s.selectedId, "1");
  assert.equal(s.phase, "reveal");
});
const betting = () => {
  const s = advanceFinal(voting(), topics, null, { type: "tick" }, 34000, 0);
  return advanceFinal(s, topics, null, { type: "tick" }, 36000, 0);
};
test("hidden question and stakes stay private, teammates share one bet and response", () => {
  let s = betting();
  assert.equal(publicFinal(s, topics, null).question, undefined);
  s = advanceFinal(s, topics, "ally", { type: "bet", stake: 100 }, 36001, 0);
  assert.deepEqual(publicFinal(s, topics, null).bets, {});
  s = advanceFinal(s, topics, "a", { type: "bet", stake: 50 }, 36002, 0);
  assert.equal(s.bets.a, 100);
  s = advanceFinal(s, topics, "b", { type: "bet", stake: 1 }, 36003, 0);
  assert.equal(s.phase, "answer");
  s = advanceFinal(s, topics, "ally", { type: "answer", answer: "ЕЖ" }, 36004, 0);
  assert.equal(publicFinal(s, topics, null).correctAnswer, undefined);
  assert.deepEqual(publicFinal(s, topics, null).responses, {});
  s = advanceFinal(s, topics, "b", { type: "answer", answer: "ошибка" }, 36005, 0);
  assert.equal(s.responses.a.delta, 100);
  assert.equal(s.responses.b.delta, -1);
  assert.equal(publicFinal(s, topics, null).correctAnswer, "ёж");
});
test("timeouts supply one point and penalize missing answers exactly once", () => {
  let s = advanceFinal(betting(), topics, null, { type: "tick" }, 66000, 0);
  assert.deepEqual(s.bets, { a: 1, b: 1 });
  s = advanceFinal(s, topics, "a", { type: "answer", answer: "ёж" }, 86000, 0);
  assert.equal(s.responses.a.delta, -1);
  assert.equal(s.phase, "result");
  assert.equal(s.deadlineAt, 93000);
  assert.equal(advanceFinal(s, topics, null, { type: "tick" }, 92999, 0), s);
  s = advanceFinal(s, topics, null, { type: "tick" }, 93000, 0);
  assert.equal(s.phase, "done");
});
test("fractional, excessive, negative and nonfinite stakes are rejected", () => {
  let s = betting();
  for (const stake of [0, -1, 1.5, 101, Infinity, NaN])
    s = advanceFinal(s, topics, "a", { type: "bet", stake }, 36001, 0);
  assert.deepEqual(s.bets, {});
});

test("public final themes include answer formats without exposing their questions", () => {
  const state = createFinal(topics, players, 0);
  const view = publicFinal(state, topics, null);
  assert.deepEqual(
    view.topics.map((t) => t.questionType),
    ["text", "choice", "text"],
  );
  assert.equal(view.question, undefined);
  assert.ok(!JSON.stringify(view).includes("Скрытый вопрос"));
});

test("score mode redacts final bets and payouts while achievement mode can reveal them", () => {
  const final = {
    ...betting(),
    phase: "result" as const,
    bets: { a: 100, b: 1 },
    responses: {
      a: { answer: "еж", correct: true, delta: 100 },
      b: { answer: "", correct: false, delta: -1 },
    },
  };
  const hidden = publicFinal(final, topics, "a", true);
  assert.deepEqual(hidden.bets, {});
  assert.equal(hidden.responses.a.delta, undefined);
  assert.equal(hidden.responses.a.correct, true);
  assert.equal(hidden.responses.a.answer, "еж");
  assert.equal(
    publicFinal({ ...final, phase: "done" }, topics, null, true).responses.b.delta,
    undefined,
  );
  assert.equal(publicFinal(final, topics, null, false).responses.a.delta, 100);
  assert.equal(final.responses.a.delta, 100);
});
