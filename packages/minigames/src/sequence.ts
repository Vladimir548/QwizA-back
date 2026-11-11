import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";

export const SEQUENCE_SHAPES = [
  "circle",
  "triangle",
  "square",
  "star",
  "heart",
  "diamond",
  "hexagon",
] as const;
export type SequenceShape = (typeof SEQUENCE_SHAPES)[number];
export const SEQUENCE_MAX_PLAYERS = 12;
export const SEQUENCE_SHOW_MS = 4000;
export const SEQUENCE_ANSWER_MS = 30000;
export const SEQUENCE_ROUNDS = 10;
export const SEQUENCE_INITIAL_LENGTH = 6;

export interface SequencePlayer extends MinigamePlayer {
  state: "thinking" | "passed" | "out";
  points: number;
}
export interface SequenceCommand extends MinigameCommand {
  type: "ready" | "rematch" | "submit";
  round?: number;
  answer?: SequenceShape[];
}
export interface SequenceSnapshot extends MinigameSnapshot {
  phase: "lobby" | "showing" | "answering" | "between" | "complete";
  players: SequencePlayer[];
  round: number;
  sequenceLength: number;
  sequence: SequenceShape[] | null;
  deadline: number | null;
  winnerIds: string[];
  matchNumber: number;
}
export interface SequenceMatch extends Omit<
  SequenceSnapshot,
  "id" | "code" | "revision" | "serverTime" | "sequence"
> {
  sequence: SequenceShape[];
}

export function sequenceForRound(
  round: number,
  randomIndex: (upper: number) => number,
): SequenceShape[] {
  if (!Number.isInteger(round) || round < 1 || round > SEQUENCE_ROUNDS)
    throw new Error("Неверный раунд.");
  const sequence: SequenceShape[] = [];
  for (let index = 0; index < SEQUENCE_INITIAL_LENGTH + round - 1; index++) {
    const available = SEQUENCE_SHAPES.filter(
      (shape) => sequence.filter((item) => item === shape).length < 3,
    );
    const pick = randomIndex(available.length);
    if (!Number.isInteger(pick) || pick < 0 || pick >= available.length)
      throw new Error("Неверный источник случайных чисел.");
    sequence.push(available[pick]);
  }
  return sequence;
}
export function createSequenceMatch(roundId: string): SequenceMatch {
  return {
    phase: "lobby",
    players: [],
    roundId,
    round: 0,
    sequenceLength: 6,
    sequence: [],
    deadline: null,
    winnerIds: [],
    matchNumber: 1,
  };
}
export function addSequencePlayer(match: SequenceMatch, id: string, name: string) {
  if (
    match.phase !== "lobby" ||
    match.players.length >= SEQUENCE_MAX_PLAYERS ||
    match.players.some((p) => p.id === id)
  )
    throw new Error("За столом нет свободных мест.");
  match.players.push({
    id,
    name,
    score: 0,
    ready: false,
    connected: false,
    state: "thinking",
    points: 0,
  });
  for (const player of match.players) player.ready = false;
}
function startRound(match: SequenceMatch, now: number, randomIndex: (upper: number) => number) {
  match.round++;
  match.sequence = sequenceForRound(match.round, randomIndex);
  match.sequenceLength = match.sequence.length;
  match.phase = "showing";
  match.deadline = now + SEQUENCE_SHOW_MS;
  for (const player of match.players) if (player.state !== "out") player.state = "thinking";
}
function resolveRound(match: SequenceMatch, now: number) {
  if (match.players.some((p) => p.state === "thinking")) return;
  const survivors = match.players.filter((p) => p.state === "passed");
  if (survivors.length <= 1 || match.round === SEQUENCE_ROUNDS) {
    match.phase = "complete";
    match.deadline = null;
    match.winnerIds = survivors.map((p) => p.id);
    for (const player of match.players) {
      if (match.winnerIds.includes(player.id)) player.score++;
      player.ready = false;
    }
  } else {
    match.phase = "between";
    match.deadline = now + 2000;
  }
}
export function advanceSequence(
  match: SequenceMatch,
  now: number,
  randomIndex: (upper: number) => number,
) {
  if (!Number.isFinite(now)) return;
  while (match.deadline !== null && now >= match.deadline) {
    const at = match.deadline;
    if (match.phase === "showing") {
      match.phase = "answering";
      match.deadline = at + SEQUENCE_ANSWER_MS;
    } else if (match.phase === "answering") {
      for (const player of match.players) if (player.state === "thinking") player.state = "out";
      resolveRound(match, at);
    } else if (match.phase === "between") startRound(match, at, randomIndex);
    else break;
  }
}
export function applySequenceCommand(
  match: SequenceMatch,
  playerId: string,
  command: SequenceCommand,
  now: number,
  nextRoundId: string,
  randomIndex: (upper: number) => number,
) {
  advanceSequence(match, now, randomIndex);
  const player = match.players.find((p) => p.id === playerId);
  if (!player?.connected) throw new Error("Игрок должен быть на связи.");
  if (command.roundId !== match.roundId) throw new Error("Матч уже сменился.");
  if (command.type === "submit") {
    if (match.phase !== "answering" || command.round !== match.round || player.state !== "thinking")
      throw new Error("Ответ сейчас не принимается.");
    if (
      !Array.isArray(command.answer) ||
      command.answer.length !== match.sequenceLength ||
      command.answer.some((shape) => !SEQUENCE_SHAPES.includes(shape))
    )
      throw new Error("Заполни всю последовательность.");
    const correct = command.answer.every((shape, index) => shape === match.sequence[index]);
    player.state = correct ? "passed" : "out";
    if (correct) player.points++;
    resolveRound(match, now);
    return;
  }
  if (
    (command.type !== "ready" || match.phase !== "lobby") &&
    (command.type !== "rematch" || match.phase !== "complete")
  )
    throw new Error("Действие сейчас недоступно.");
  if (match.players.length < 2 || match.players.some((p) => !p.connected))
    throw new Error("Дождись всех участников.");
  player.ready = true;
  if (!match.players.every((p) => p.ready)) return;
  const matchNumber = match.matchNumber + Number(command.type === "rematch"),
    players = match.players;
  Object.assign(match, createSequenceMatch(nextRoundId), { players, matchNumber });
  for (const participant of players) {
    participant.ready = false;
    participant.state = "thinking";
    participant.points = 0;
  }
  startRound(match, now, randomIndex);
}
export function sequencePublicState(
  match: SequenceMatch,
): Omit<SequenceSnapshot, "id" | "code" | "revision" | "serverTime"> {
  return {
    phase: match.phase,
    roundId: match.roundId,
    players: match.players.map((p) => ({ ...p })),
    round: match.round,
    sequenceLength: match.sequenceLength,
    sequence: match.phase === "showing" ? [...match.sequence] : null,
    deadline: match.deadline,
    winnerIds: [...match.winnerIds],
    matchNumber: match.matchNumber,
  };
}
