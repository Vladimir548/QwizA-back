import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeRound,
  buildRoomPresentation,
  chooseSeatNumber,
  chooseTeamSeat,
  chooseBuzzWinner,
  closestWinners,
  hostJudgedDelta,
  getOrCreateHostResponse,
  isCorrectAnswer,
  nextQuestionPicker,
  openingPickerCandidates,
  questionReadingDurationMs,
  roundMedia,
  voteToSkipAudio,
  seatedPlayers,
  teamScoreAdjustment,
} from "../src/rooms/rooms.service";
import type { PrivateRoomState, RoomPack, RoomQuestion } from "../src/rooms/rooms.types";
import { buildTopicPresentation } from "./fixtures/topic-presentation";

const question: RoomQuestion = {
  id: "q1",
  type: "choice",
  answerMode: "buzzer",
  answerTimeSeconds: 30,
  value: 100,
  prompt: "Столица Японии?",
  options: ["Киото", "Токио", "Осака"],
  answer: "Токио",
  acceptedAnswers: [],
};

test("round media includes question and answer assets only for the requested round", () => {
  const pack: RoomPack = {
    id: "pack",
    title: "Пак",
    description: "",
    rounds: ["Первый", "Второй"],
    topics: [
      {
        id: "first",
        title: "Тема 1",
        roundIndex: 0,
        questions: [
          {
            ...question,
            questionMedia: { id: "clip", kind: "audio" },
            answerMedia: { id: "reveal", kind: "image" },
            matchingPairs: [
              { element: "Картинка", fact: "Факт", media: { id: "reveal", kind: "image" } },
            ],
          },
        ],
      },
      {
        id: "second",
        title: "Тема 2",
        roundIndex: 1,
        questions: [{ ...question, id: "q2", questionMedia: { id: "later", kind: "video" } }],
      },
    ],
  };
  assert.deepEqual(
    roundMedia(pack, 0).map((asset) => asset.id),
    ["clip", "reveal"],
  );
  assert.deepEqual(
    roundMedia(pack, 1).map((asset) => asset.id),
    ["later"],
  );
});

test("questions without text open their content without a reading pause", () => {
  assert.equal(questionReadingDurationMs({ ...question, type: "matching", prompt: "" }), 0);
  assert.equal(questionReadingDurationMs({ ...question, type: "puzzle", prompt: "  " }), 0);
});

test("a musical question opens answers after the saved clip, then grants the full answer time", () => {
  const musical = {
    ...question,
    questionMedia: { id: "clip", kind: "audio" as const, durationSeconds: 12.4 },
  };
  assert.equal(questionReadingDurationMs(musical), 14400);
  assert.equal(questionReadingDurationMs(question), Math.max(3000, question.prompt.length * 45));
  const openedAt = 1000;
  const answerOpensAt = openedAt + questionReadingDurationMs(musical);
  assert.equal(answerOpensAt, 15400);
  assert.equal(answerOpensAt + musical.answerTimeSeconds * 1000, 45400);
});

test("video prediction waits for the stop point and matching answers use the hidden pairing", () => {
  const video: RoomQuestion = {
    ...question,
    type: "video-prediction",
    questionMedia: { id: "video", kind: "video", durationSeconds: 12 },
    videoStopSeconds: 5,
  };
  assert.equal(questionReadingDurationMs(video), 6500);
  const matching: RoomQuestion = {
    ...question,
    type: "matching",
    matchingPairs: [
      { element: "Лиса", fact: "Рыжая" },
      { element: "Слон", fact: "Большой" },
    ],
    matchingFacts: ["Большой", "Рыжая"],
  };
  assert.equal(isCorrectAnswer(matching, [1, 0]), true);
  assert.equal(isCorrectAnswer(matching, [0, 1]), false);
  assert.equal(isCorrectAnswer(matching, [1, 1]), false);
});

test("audio listening ends only after every player votes and resets the answer clock", () => {
  const state = {
    readingEndsAt: 20_000,
    buzzOpensAt: 20_000,
    deadlineAt: 50_000,
    audioSkippedPlayers: [],
  } as unknown as PrivateRoomState;
  assert.equal(voteToSkipAudio(state, ["a", "b"], "a", 5_000, 30), false);
  assert.equal(state.buzzOpensAt, 20_000);
  assert.equal(voteToSkipAudio(state, ["a", "b"], "a", 5_100, 30), false);
  assert.deepEqual(state.audioSkippedPlayers, ["a"]);
  assert.equal(voteToSkipAudio(state, ["a", "b"], "b", 6_000, 30), true);
  assert.deepEqual(state.audioSkippedPlayers, ["a", "b"]);
  assert.equal(state.readingEndsAt, 6_000);
  assert.equal(state.buzzOpensAt, 6_000);
  assert.equal(state.deadlineAt, 36_000);
});

test("server grades text and choice answers without client correctness flags", () => {
  assert.equal(isCorrectAnswer(question, 1), true);
  assert.equal(isCorrectAnswer(question, " ТОКИО "), true);
  assert.equal(isCorrectAnswer(question, 0), false);
  assert.equal(isCorrectAnswer(question, "Киото"), false);
  const videoText: RoomQuestion = {
    ...question,
    type: "video-prediction",
    options: [],
    answer: "Создастся игра",
    acceptedAnswers: ["Создастся комната"],
  };
  assert.equal(isCorrectAnswer(videoText, "создастся игр"), true);
  assert.equal(isCorrectAnswer(videoText, "создастся комнату"), true);
  assert.equal(isCorrectAnswer({ ...videoText, acceptedAnswers: [] }, "создастся комната"), false);
});

test("numeric closest awards the nearest guess and keeps ties", () => {
  const replies = [
    { participantId: "a", answer: 48, correct: false, scoreDelta: 0 },
    { participantId: "b", answer: 52, correct: false, scoreDelta: 0 },
    { participantId: "c", answer: 70, correct: false, scoreDelta: 0 },
  ];
  assert.deepEqual(closestWinners(replies, 50), ["a", "b"]);
  assert.deepEqual(closestWinners([], 50), []);
});

test("host verdict awards normal, double or half points and preserves penalties", () => {
  assert.equal(hostJudgedDelta(question, true, 1), 100);
  assert.equal(hostJudgedDelta(question, true, 2), 200);
  assert.equal(hostJudgedDelta(question, true, 0.5), 50);
  assert.equal(hostJudgedDelta(question, false, 1), -100);
  assert.equal(hostJudgedDelta(question, false, 2, { shield: true }), 0);
  assert.equal(hostJudgedDelta(question, true, 2, { double: true }), 400);
  assert.equal(hostJudgedDelta({ ...question, type: "risk" }, true, 0.5), 100);
});

test("team score adjustment changes only the selected team's aggregate", () => {
  const players = [
    { id: "second", role: "player", teamId: "team-1", seatNumber: 2, score: 200 },
    { id: "other", role: "player", teamId: "team-2", seatNumber: 1, score: 400 },
    { id: "first", role: "player", teamId: "team-1", seatNumber: 1, score: 100 },
  ];
  const update = teamScoreAdjustment(players, "team-1", 900);
  assert.deepEqual(update, { participantId: "first", score: 700 });
  assert.equal(players[1].score, 400);
  assert.equal(teamScoreAdjustment(players, "team-3", 100), null);
});

test("host can record a spoken answer without any player submission", () => {
  const state = { responses: [] } as unknown as PrivateRoomState;
  const spoken = getOrCreateHostResponse(state, "player-a", "Александрия");
  assert.equal(spoken.verbal, true);
  assert.equal(spoken.answer, "Александрия");
  assert.equal(spoken.participantId, "player-a");
  assert.equal(state.responses.length, 1);
  assert.equal(getOrCreateHostResponse(state, "player-a"), spoken);
  assert.equal(state.responses.length, 1);
});

test("a player can move into a specific free seat but cannot take an occupied one", () => {
  const players = [
    { teamId: "team-1", seatNumber: 1 },
    { teamId: "team-1", seatNumber: 3 },
    { teamId: "team-2", seatNumber: 2 },
  ];
  assert.deepEqual(chooseSeatNumber(players, "team-1", 3), { seatNumber: 2 });
  assert.deepEqual(chooseSeatNumber(players, "team-1", 3, 2), { seatNumber: 2 });
  assert.match(chooseSeatNumber(players, "team-1", 3, 3).error ?? "", /занято/);
  assert.match(chooseSeatNumber(players, "team-1", 3, 4).error ?? "", /существующее/);
  assert.deepEqual(chooseSeatNumber(players, "team-2", 3, 1), { seatNumber: 1 });
});

test("question selection follows the correct responder or the next occupied seat", () => {
  const players = [
    { id: "third", role: "player", teamId: null, seatNumber: 3 },
    { id: "host", role: "host", teamId: null, seatNumber: null },
    { id: "first", role: "player", teamId: null, seatNumber: 1 },
    { id: "second", role: "player", teamId: null, seatNumber: 2 },
  ];
  const response = (participantId: string, correct: boolean) => ({
    participantId,
    answer: "ответ",
    correct,
    scoreDelta: correct ? 100 : -100,
  });
  assert.deepEqual(
    seatedPlayers(players).map((person) => person.id),
    ["first", "second", "third"],
  );
  assert.equal(nextQuestionPicker(players, "first", [response("first", true)]), "first");
  assert.equal(nextQuestionPicker(players, "first", [response("second", true)]), "second");
  assert.equal(nextQuestionPicker(players, "first", [response("second", false)]), "third");
  assert.equal(nextQuestionPicker(players, "first", [response("third", false)]), "first");
  assert.equal(nextQuestionPicker(players, "second", []), "third");
  assert.equal(nextQuestionPicker(players, "first", [], "third"), "first");
  assert.equal(
    nextQuestionPicker(players, "first", [response("second", false), response("third", true)]),
    "third",
  );
});

test("team roulette selects a team uniformly, then its first occupied seat", () => {
  const players = [
    { id: "b2", role: "player", teamId: "team-2", seatNumber: 2 },
    { id: "a2", role: "player", teamId: "team-1", seatNumber: 2 },
    { id: "a1", role: "player", teamId: "team-1", seatNumber: 1 },
    { id: "b1", role: "player", teamId: "team-2", seatNumber: 1 },
  ];
  assert.deepEqual(
    openingPickerCandidates(players, "team").map((player) => player.id),
    ["a1", "b1"],
  );
  assert.deepEqual(
    openingPickerCandidates(players, "solo").map((player) => player.id),
    ["a1", "a2", "b1", "b2"],
  );
});

test("server checks puzzle order and all distinct image differences", () => {
  const puzzle: RoomQuestion = { ...question, type: "puzzle", puzzleGridSize: 2 };
  assert.equal(isCorrectAnswer(puzzle, [0, 1, 2, 3]), true);
  assert.equal(isCorrectAnswer(puzzle, [1, 0, 2, 3]), false);
  const difference: RoomQuestion = {
    ...question,
    type: "spot-difference",
    differenceTargets: [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.8 },
    ],
    differenceTolerancePercent: 5,
  };
  assert.equal(
    isCorrectAnswer(difference, [
      { x: 0.81, y: 0.79 },
      { x: 0.21, y: 0.2 },
    ]),
    true,
  );
  assert.equal(
    isCorrectAnswer(difference, [
      { x: 0.21, y: 0.2 },
      { x: 0.22, y: 0.2 },
    ]),
    false,
  );
});

test("server grades map coordinates with its own target", () => {
  const geo: RoomQuestion = {
    ...question,
    type: "geo",
    answer: "Париж",
    geoTarget: { lat: 48.8566, lng: 2.3522 },
    geoToleranceKm: 10,
  };
  assert.equal(isCorrectAnswer(geo, { lat: 48.8566, lng: 2.3522 }), true);
  assert.equal(isCorrectAnswer(geo, { lat: 52.52, lng: 13.405 }), false);
});

test("server grades image-map and comparison answers without exposing their targets", () => {
  const imageMap: RoomQuestion = {
    ...question,
    type: "geo",
    geoMapMode: "image",
    imageTarget: { x: 0.5, y: 0.5 },
    imageTolerancePercent: 5,
  };
  assert.equal(isCorrectAnswer(imageMap, { x: 0.51, y: 0.52 }), true);
  assert.equal(isCorrectAnswer(imageMap, { x: 0.8, y: 0.7 }), false);
  const comparison: RoomQuestion = {
    ...question,
    type: "comparison",
    comparisonOptions: [
      { id: "a", label: "A", amount: 12 },
      { id: "b", label: "B", amount: 20 },
    ],
  };
  assert.equal(isCorrectAnswer(comparison, "b"), true);
  assert.equal(isCorrectAnswer(comparison, "a"), false);
});

test("arbitration uses a server seed, independent of client arrival order", () => {
  const candidates = [
    { participantId: "a", receivedAt: 1000 },
    { participantId: "b", receivedAt: 1050 },
  ];
  const winner = chooseBuzzWinner(candidates, "server-secret-seed");
  assert.equal(chooseBuzzWinner([...candidates].reverse(), "server-secret-seed"), winner);
  assert.ok(winner === "a" || winner === "b");
});

test("network board moves to the next pack round only after the current round is played", () => {
  const pack: RoomPack = {
    id: "multi",
    title: "Раунды",
    rounds: ["Первый", "Второй"],
    topics: [
      { id: "one", title: "Первый", roundIndex: 0, questions: [{ ...question, id: "first" }] },
      { id: "two", title: "Второй", roundIndex: 1, questions: [{ ...question, id: "second" }] },
    ],
  };
  const state: PrivateRoomState = { phase: "board", played: [], buzzCandidates: [], responses: [] };
  assert.equal(activeRound(pack, state), 0);
  state.played = ["first"];
  state.currentQuestionId = "first";
  assert.equal(activeRound(pack, state), 0);
  state.currentQuestionId = undefined;
  assert.equal(activeRound(pack, state), 1);
});

test("topic presentation includes every round and gives each topic a shared reveal window", () => {
  const pack: RoomPack = {
    id: "multi",
    title: "Раунды",
    rounds: ["Разминка", "Финал"],
    topics: [
      { id: "one", title: "Кино", roundIndex: 0, questions: [question] },
      { id: "two", title: "Музыка", roundIndex: 0, questions: [question] },
      { id: "three", title: "Наука", roundIndex: 1, questions: [question] },
    ],
  };
  const rounds = buildRoomPresentation(pack, 1000);
  assert.deepEqual(
    rounds.map((round) => [round.title, ...round.topics.map((topic) => topic.title)]),
    [
      ["Разминка", "Кино", "Музыка"],
      ["Финал", "Наука"],
    ],
  );
  assert.equal(rounds[0].startsAt, 3400);
  assert.deepEqual(rounds, buildTopicPresentation(pack.rounds ?? [], pack.topics, 1000));
  assert.equal(rounds[1].startsAt, rounds[0].endsAt);
  assert.ok(rounds[1].endsAt > rounds[1].startsAt);
});

test("team seats honor the requested team and never exceed its capacity", () => {
  const room = { gameMode: "team", teamCount: 3, maxPlayers: 9 };
  const players = [
    { teamId: "team-1" },
    { teamId: "team-2" },
    { teamId: "team-2" },
    { teamId: "team-2" },
  ];
  assert.deepEqual(chooseTeamSeat(room, players, 3), { teamId: "team-3" });
  assert.deepEqual(chooseTeamSeat(room, players), { teamId: "team-3" });
  assert.match(chooseTeamSeat(room, players, 2).error ?? "", /нет свободных мест/);
  assert.match(chooseTeamSeat(room, players, 4).error ?? "", /существующую команду/);
});
