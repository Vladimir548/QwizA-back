export const MOMENT_COUNTDOWN_MS = 3000;
export const MOMENT_MIN_PLAYERS = 2;
export const MOMENT_MAX_PLAYERS = 12;
export const MOMENT_GRACE_MS = 3000;

export interface MomentSettings {
  targetMs: number;
  roundCount: number;
}

export interface MomentPlayer extends MinigamePlayer {
  stopped: boolean;
}

export interface MomentAttempt {
  playerId: string;
  elapsedMs: number | null;
  errorMs: number | null;
  autoStopped?: boolean;
}

export interface MomentRoundResult {
  round: number;
  targetMs: number;
  winnerIds: string[];
  attempts: MomentAttempt[];
}

export interface MomentSnapshot {
  id: string;
  code: string;
  revision: number;
  serverTime: number;
  phase: "lobby" | "countdown" | "running" | "result" | "complete";
  settings: MomentSettings;
  round: number;
  roundId: string;
  startsAt: number | null;
  endsAt: number | null;
  players: MomentPlayer[];
  result: MomentRoundResult | null;
  history: MomentRoundResult[];
  ownElapsedMs?: number | null;
}

export type MomentSession = MinigameSession;

export interface MomentCommand {
  id: string;
  roundId: string;
  type: "ready" | "stop" | "rematch";
  elapsedMs?: number;
}

export interface MomentAck {
  ok: boolean;
  error?: string;
  snapshot?: MomentSnapshot;
}

/** Server-only state. Attempts are omitted from snapshots until the round ends. */
export interface MomentMatch {
  settings: MomentSettings;
  phase: MomentSnapshot["phase"];
  round: number;
  roundId: string;
  startsAt: number | null;
  endsAt: number | null;
  players: MomentPlayer[];
  attempts: MomentAttempt[];
  history: MomentRoundResult[];
}

export function createMomentMatch(settings: MomentSettings, roundId: string): MomentMatch {
  if (
    !Number.isInteger(settings.targetMs) ||
    settings.targetMs < 3000 ||
    settings.targetMs > 10000 ||
    settings.targetMs % 1000 !== 0 ||
    ![3, 5, 7].includes(settings.roundCount)
  )
    throw new Error("Цель должна быть от 3 до 10 целых секунд, серия — из 3, 5 или 7 раундов.");
  return {
    settings: { ...settings },
    phase: "lobby",
    round: 1,
    roundId,
    startsAt: null,
    endsAt: null,
    players: [],
    attempts: [],
    history: [],
  };
}

export function addMomentPlayer(match: MomentMatch, id: string, name: string) {
  if (
    match.phase !== "lobby" ||
    match.players.length >= MOMENT_MAX_PLAYERS ||
    match.players.some((player) => player.id === id)
  )
    throw new Error("За столом нет свободных мест.");
  match.players.push({ id, name, score: 0, ready: false, stopped: false, connected: false });
  for (const player of match.players) player.ready = false;
}

function finishRound(match: MomentMatch) {
  const valid = match.attempts.filter((attempt) => attempt.errorMs !== null);
  const best = valid.length ? Math.min(...valid.map((attempt) => attempt.errorMs!)) : null;
  const winnerIds = valid.filter((attempt) => attempt.errorMs === best).map((a) => a.playerId);
  for (const player of match.players) {
    if (winnerIds.includes(player.id)) player.score += 1;
    player.ready = false;
  }
  match.history.push({
    round: match.round,
    targetMs: match.settings.targetMs,
    winnerIds,
    attempts: [...match.attempts],
  });
  match.phase = match.round === match.settings.roundCount ? "complete" : "result";
}

export function advanceMoment(match: MomentMatch, now: number) {
  if (match.phase === "countdown" && now >= match.startsAt!) match.phase = "running";
  if (match.phase === "running" && now >= match.endsAt!) {
    for (const player of match.players) {
      if (player.stopped) continue;
      player.stopped = true;
      match.attempts.push({
        playerId: player.id,
        elapsedMs: match.settings.targetMs + MOMENT_GRACE_MS,
        errorMs: MOMENT_GRACE_MS,
        autoStopped: true,
      });
    }
    finishRound(match);
  }
}

export function applyMomentCommand(
  match: MomentMatch,
  playerId: string,
  command: MomentCommand,
  now: number,
  nextRoundId: string,
  nextTargetMs = match.settings.targetMs,
  timingAllowanceMs = 250,
) {
  advanceMoment(match, now);
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Место игрока не найдено.");
  if (command.roundId !== match.roundId) throw new Error("Раунд уже сменился. Обновляем стол.");

  if (command.type === "stop") {
    if (match.phase !== "running" || player.stopped)
      throw new Error("Остановить секундомер сейчас нельзя.");
    const elapsed = command.elapsedMs;
    const serverElapsed = now - match.startsAt!;
    if (
      typeof elapsed !== "number" ||
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      Math.abs(elapsed - serverElapsed) > timingAllowanceMs
    )
      throw new Error("Время не совпало с сервером. Проверь соединение и повтори остановку.");
    const elapsedMs = Math.min(Math.round(elapsed), match.settings.targetMs + MOMENT_GRACE_MS);
    player.stopped = true;
    match.attempts.push({
      playerId,
      elapsedMs,
      errorMs: Math.abs(elapsedMs - match.settings.targetMs),
    });
    if (match.players.every((candidate) => candidate.stopped)) finishRound(match);
    return;
  }

  const rematch = command.type === "rematch";
  if (
    (rematch && match.phase !== "complete") ||
    (!rematch && !["lobby", "result"].includes(match.phase))
  )
    throw new Error("Сейчас нельзя начать новый раунд.");
  if (match.players.length < MOMENT_MIN_PLAYERS || match.players.some((p) => !p.connected))
    throw new Error("Для старта нужны хотя бы два игрока и подключение всех участников.");
  if (
    !Number.isInteger(nextTargetMs) ||
    nextTargetMs < 3000 ||
    nextTargetMs > 10000 ||
    nextTargetMs % 1000 !== 0
  )
    throw new Error("Цель должна быть от 3 до 10 целых секунд.");
  player.ready = true;
  if (!match.players.every((candidate) => candidate.ready)) return;
  if (rematch) {
    match.round = 1;
    match.history = [];
    for (const participant of match.players) participant.score = 0;
  } else if (match.phase === "result") match.round += 1;
  match.roundId = nextRoundId;
  match.settings.targetMs = nextTargetMs;
  match.attempts = [];
  for (const participant of match.players) {
    participant.ready = false;
    participant.stopped = false;
  }
  match.startsAt = now + MOMENT_COUNTDOWN_MS;
  match.endsAt = match.startsAt + match.settings.targetMs + MOMENT_GRACE_MS;
  match.phase = "countdown";
}

export function momentPublicState(
  match: MomentMatch,
): Omit<MomentSnapshot, "id" | "code" | "revision" | "serverTime"> {
  return {
    settings: { ...match.settings },
    phase: match.phase,
    round: match.round,
    roundId: match.roundId,
    startsAt: match.startsAt,
    endsAt: match.endsAt,
    players: match.players.map((player) => ({ ...player })),
    result: ["result", "complete"].includes(match.phase) ? (match.history.at(-1) ?? null) : null,
    history: match.history.map((result) => ({
      ...result,
      winnerIds: [...result.winnerIds],
      attempts: result.attempts.map((a) => ({ ...a })),
    })),
  };
}

export function formatMomentTime(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(3).replace(".", ",");
}
import type { MinigamePlayer, MinigameSession } from "./session";
