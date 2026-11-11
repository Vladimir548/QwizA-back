import assert from "node:assert/strict";
import { test } from "node:test";
import { captureQuizStatistics, createQuizStatistics } from "../src/quiz-statistics";
import {
  defaultVictoryRules,
  VICTORY_CRITERION_IDS,
  isVictoryRules,
  summarizeQuizResults,
} from "../src/quiz-victory";

test("new victory settings select every nomination and keep separate mutable selections", () => {
  const rules = defaultVictoryRules();
  assert.deepEqual(rules.criteria, VICTORY_CRITERION_IDS);
  rules.criteria.pop();
  assert.deepEqual(defaultVictoryRules().criteria, VICTORY_CRITERION_IDS);
});

test("earnings exclude starting scores and host corrections; team peaks use concurrent team scores", () => {
  const start = [
    { id: "a", teamId: "team-1", score: 100 },
    { id: "b", teamId: "team-1", score: 100 },
    { id: "c", teamId: "team-2", score: 0 },
  ];
  const win = start.map((p) => ({ ...p, score: p.id === "a" ? 300 : p.score }));
  let stats = captureQuizStatistics(createQuizStatistics(start), start, win, {
    question: {
      id: "q1",
      answers: [
        { playerId: "a", answered: true, correct: false },
        { playerId: "b", answered: true, correct: true },
      ],
    },
  });
  assert.equal(stats.byId.a.earned, 200);
  assert.equal(stats.byId["team-1"].answered, 1);
  assert.equal(stats.byId["team-1"].correct, 1);
  const lose = win.map((p) => ({ ...p, score: p.id === "a" ? -100 : p.score }));
  stats = captureQuizStatistics(stats, win, lose);
  const corrected = lose.map((p) => ({ ...p, score: p.id === "b" ? 1000 : p.score }));
  stats = captureQuizStatistics(stats, lose, corrected, { manual: true });
  assert.equal(stats.byId.a.lost, 400);
  assert.equal(stats.byId.b.earned, 0);
  assert.equal(stats.byId.b.adjustments, 900);
  assert.equal(stats.byId["team-1"].peak, 900);
  assert.notEqual(stats.byId["team-1"].peak, stats.byId.a.peak + stats.byId.b.peak);
  assert.deepEqual(
    start.map((p) => p.score),
    [100, 100, 0],
  );
});

test("timeouts do not count as submitted answers and replayed settlements do not duplicate answers or wins", () => {
  const players = [
    { id: "a", score: 0 },
    { id: "b", score: 0 },
  ];
  const event = {
    question: {
      id: "q",
      answers: [
        { playerId: "a", answered: false, correct: false },
        { playerId: "b", answered: true, correct: true },
      ],
    },
    minigame: { id: "mini", playerIds: ["a", "b"], winnerIds: ["b"], duel: true },
  };
  let stats = captureQuizStatistics(createQuizStatistics(players), players, players, event);
  stats = captureQuizStatistics(stats, players, players, event);
  assert.equal(stats.byId.a.answered, 0);
  assert.equal(stats.byId.b.answered, 1);
  assert.equal(stats.byId.b.correct, 1);
  assert.equal(stats.byId.b.minigamesPlayed, 1);
  assert.equal(stats.byId.b.minigamesWon, 1);
  assert.equal(stats.byId.b.duelsWon, 1);
});

test("a shared mini-game win counts once per team even with several representatives", () => {
  const players = [
    { id: "a", score: 0, teamId: "team-1" },
    { id: "b", score: 0, teamId: "team-1" },
    { id: "c", score: 0, teamId: "team-2" },
  ];
  const stats = captureQuizStatistics(createQuizStatistics(players), players, players, {
    minigame: { id: "mini", playerIds: ["a", "b", "c"], winnerIds: ["a", "b"] },
  });
  assert.equal(stats.byId["team-1"].minigamesPlayed, 1);
  assert.equal(stats.byId["team-1"].minigamesWon, 1);
});

test("achievements can beat a higher score; tied category leaders earn one each and a global tie earns none", () => {
  const players = [
    { id: "a", name: "А", score: 1000 },
    { id: "b", name: "Б", score: 200 },
    { id: "c", name: "В", score: -100 },
  ];
  const stats = createQuizStatistics(players);
  Object.assign(stats.byId.a, { correct: 2, earned: 1000, minigamesWon: 0 });
  Object.assign(stats.byId.b, { correct: 5, earned: 1200, minigamesWon: 2 });
  Object.assign(stats.byId.c, { correct: 5, earned: 200, minigamesWon: 1 });
  const result = summarizeQuizResults(players, stats, {
    mode: "achievements",
    criteria: ["score", "correct", "earned", "minigameWins", "fewestLosses"],
  });
  assert.equal(result.standings[0].id, "b");
  assert.equal(result.standings[0].victoryPoints, 3);
  assert.deepEqual(result.awards.find((a) => a.criterion === "correct")!.winnerIds, ["b", "c"]);
  assert.deepEqual(result.awards.find((a) => a.criterion === "fewestLosses")!.winnerIds, []);
  assert.equal(summarizeQuizResults(players, stats).standings[0].id, "a");
  const tied = summarizeQuizResults(players, stats, {
    mode: "achievements",
    criteria: ["minigameWins", "score"],
  });
  assert.equal(tied.standings.filter((e) => e.place === 1).length, 2);
  assert.equal(tied.standings.find((e) => e.id === "c")!.place, 3);
});

test("empty or duplicate victory criteria and client-forged rule modes are rejected", () => {
  for (const rules of [
    { mode: "achievements", criteria: [] },
    { mode: "score", criteria: ["score", "score"] },
    { mode: "x", criteria: ["score"] },
    { mode: "score", criteria: ["made-up"] },
    null,
  ])
    assert.equal(isVictoryRules(rules), false);
  assert.equal(isVictoryRules({ mode: "achievements", criteria: ["score", "earned"] }), true);
});
