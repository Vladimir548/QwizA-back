import type { TopicMinigameEvent } from "@qwiza/minigames";
export type RoomPhase =
  | "final"
  | "lobby"
  | "loading"
  | "presentation"
  | "board"
  | "question"
  | "review"
  | "result"
  | "minigame-vote"
  | "minigame"
  | "minigame-result"
  | "duel"
  | "duel-result";
export type RoomRole = "host" | "player";
export type RoomMode = "solo" | "team";

export interface RoomQuestion {
  id: string;
  type:
    | "text"
    | "choice"
    | "risk"
    | "geo"
    | "image-point"
    | "comparison"
    | "numeric-closest"
    | "puzzle"
    | "spot-difference"
    | "matching"
    | "video-prediction";
  answerMode: "buzzer" | "everyone";
  answerTimeSeconds: number;
  value: number;
  prompt: string;
  options: string[];
  answer: string;
  acceptedAnswers: string[];
  questionMedia?: { id: string; kind: "image" | "video" | "audio"; durationSeconds?: number };
  answerMedia?: { id: string; kind: "image" | "video" | "audio"; durationSeconds?: number };
  geoMapMode?: "world" | "image";
  geoMapMedia?: { id: string; kind: "image" | "video" | "audio"; durationSeconds?: number };
  geoTarget?: { lat: number; lng: number };
  geoToleranceKm?: number;
  imageTarget?: { x: number; y: number };
  imageTolerancePercent?: number;
  comparisonOptions?: {
    id: string;
    label: string;
    amount: number;
    media?: { id: string; kind: "image" | "video" | "audio"; durationSeconds?: number };
  }[];
  comparisonUnit?: string;
  numericTarget?: number;
  numericUnit?: string;
  puzzleGridSize?: number;
  differenceMedia?: { id: string; kind: "image" | "video" | "audio"; durationSeconds?: number };
  differenceTargets?: { x: number; y: number }[];
  differenceTolerancePercent?: number;
  matchingPairs?: {
    element: string;
    fact: string;
    media?: { id: string; kind: "image" | "video" | "audio"; durationSeconds?: number };
  }[];
  matchingFacts?: string[];
  videoStopSeconds?: number;
}

export interface RoomPack {
  id: string;
  title: string;
  description?: string;
  rounds?: string[];
  topics: {
    id: string;
    title: string;
    isFinal?: boolean;
    roundIndex?: number;
    ordered?: boolean;
    direction?: "forward" | "reverse";
    questions: RoomQuestion[];
  }[];
}

export interface RoomResponse {
  participantId: string;
  answer:
    | string
    | number
    | number[]
    | { x: number; y: number }
    | { lat: number; lng: number }
    | { x: number; y: number }[];
  correct: boolean;
  scoreDelta: number;
  judged?: boolean;
  verbal?: boolean;
  shielded?: boolean;
  distanceKm?: number;
  distancePercent?: number;
  awardedPower?: "double" | "shield" | "freeze";
}

export interface PrivateRoomState {
  final?: import("@qwiza/minigames").FinalState;
  statistics?: import("@qwiza/minigames").QuizStatistics;
  victory?: import("@qwiza/minigames").VictoryRules;
  phase: RoomPhase;
  teamNames?: Record<string, string>;
  hostEnabled?: boolean;
  hostRebuzzEnabled?: boolean;
  presentationStartedAt?: number;
  loadingRoundIndex?: number;
  loadingStartedAt?: number;
  loadingAfter?: "presentation" | "board";
  loadingProgress?: Record<string, number>;
  pickerId?: string;
  lastJudgedCorrectId?: string;
  pickerRouletteStartedAt?: number;
  pickerRouletteEndsAt?: number;
  played: string[];
  answeredQuestions?: string[];
  handledTopicIds?: string[];
  topicEvent?: TopicMinigameEvent;
  duelChallenges?: Record<string, boolean>;
  duel?: import("@qwiza/minigames").DuelEvent;
  topicSkipVotes?: Record<string, string[]>;
  currentQuestionId?: string;
  openedAt?: number;
  buzzOpensAt?: number;
  deadlineAt?: number;
  buzzRemainingMs?: number;
  buzzWinnerId?: string;
  buzzCandidates: { participantId: string; receivedAt: number }[];
  skippedPlayers?: string[];
  buzzSeed?: string;
  buzzResolveAt?: number;
  responses: RoomResponse[];
  result?: {
    correctAnswer: string;
    responses: RoomResponse[];
    skipped?: boolean;
    geoTarget?: { lat: number; lng: number };
    imageTarget?: { x: number; y: number };
    numericTarget?: number;
    differenceTargets?: { x: number; y: number }[];
    matchingPairs?: {
      element: string;
      fact: string;
      media?: { id: string; kind: "image" | "video" | "audio"; durationSeconds?: number };
    }[];
    comparisonOptions?: {
      id: string;
      label: string;
      amount: number;
      media?: { id: string; kind: "image" | "video" | "audio"; durationSeconds?: number };
    }[];
    answerMedia?: { id: string; kind: "image" | "video" | "audio"; durationSeconds?: number };
  };
  powersEnabled?: boolean;
  topicMinigamesEnabled?: boolean;
  powersByPlayer?: Record<string, { double: number; shield: number; freeze: number }>;
  correctAnswers?: Record<string, number>;
  activePowers?: Record<string, { double?: boolean; shield?: boolean }>;
  frozenPlayerId?: string;
  bonusOpensAt?: number;
  readingEndsAt?: number;
  bonusSkippedPlayers?: string[];
  audioSkippedPlayers?: string[];
}

export interface RoomCommandInput {
  id: string;
  type:
    | "final"
    | "start"
    | "set-victory-rules"
    | "load-progress"
    | "force-loading"
    | "pick"
    | "skip-topic"
    | "offer-duel"
    | "accept-duel"
    | "decline-duel"
    | "cancel-duel"
    | "finish-duel"
    | "vote-minigame"
    | "finish-minigame"
    | "buzz"
    | "skip"
    | "answer"
    | "judge-answer"
    | "finish-review"
    | "next"
    | "set-score"
    | "set-team-score"
    | "change-seat"
    | "rename-team"
    | "use-power"
    | "skip-bonuses"
    | "skip-audio";
  finalCommand?: import("@qwiza/minigames").FinalCommand;
  questionId?: string;
  topicId?: string;
  minigame?: string;
  duelId?: string;
  stake?: number;
  answer?: RoomResponse["answer"];
  targetParticipantId?: string;
  verdict?: "correct" | "incorrect";
  scoreMultiplier?: 0.5 | 1 | 2;
  score?: number;
  role?: RoomRole;
  teamNumber?: number;
  seatNumber?: number;
  teamName?: string;
  power?: "double" | "shield" | "freeze";
  progress?: number;
  victory?: import("@qwiza/minigames").VictoryRules;
}

export interface RoomCommandAck {
  ok: boolean;
  error?: string;
  revision?: number;
  serverReceivedAt?: number;
  queued?: boolean;
}
