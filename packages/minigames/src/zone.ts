import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";

export const ZONE_GOAL = 100;
export const ZONE_MIN_PLAYERS = 2;
export const ZONE_MAX_PLAYERS = 12;
export const ZONE_HIT_POINTS = 10;
export const ZONE_ROTATION_MS = 1400 / (1.3 * 1.2);
export const ZONE_TIMING_ALLOWANCE_MS = 250;
export const ZONE_PAUSE_MS = 500;
export interface ZoneCheck {
  zoneStart: number;
  zoneSize: number;
  perfectSize: number;
  rotationMs: number;
}
export type ZoneGrade = "perfect" | "hit" | "miss";
export interface ZoneAttempt {
  elapsedMs: number;
  angle: number;
  grade: ZoneGrade;
  points: number;
}
export interface ZoneTarget {
  id: string;
  check: ZoneCheck;
}
export interface ZonePlayer extends MinigamePlayer {
  points: number;
  attempts: number;
  target: ZoneTarget | null;
  lastAttempt: ZoneAttempt | null;
  pausedMs: number;
  resumeAt: number | null;
  pendingTarget: ZoneTarget | null;
}
export interface ZoneCommand extends MinigameCommand {
  type: "ready" | "hit" | "rematch";
  elapsedMs?: number;
  checkId?: string;
}
export interface ZoneSnapshot extends MinigameSnapshot {
  phase: "lobby" | "countdown" | "running" | "complete";
  players: ZonePlayer[];
  matchNumber: number;
  startsAt: number | null;
  finishedAt: number | null;
  winnerId: string | null;
}
export type ZoneMatch = Omit<ZoneSnapshot, "id" | "code" | "revision" | "serverTime">;
export type ZoneTargetFactory = (previous?: ZoneCheck | null) => ZoneTarget;

export function randomZoneCheck(
  randomIndex: (upper: number) => number,
  previous?: ZoneCheck | null,
): ZoneCheck {
  const upper = previous ? 240 : 360;
  const offset = randomIndex(upper);
  if (!Number.isInteger(offset) || offset < 0 || offset >= upper)
    throw new Error("Неверное положение сектора.");
  return {
    zoneStart: previous ? (previous.zoneStart + 60 + offset) % 360 : offset,
    zoneSize: 23.4,
    perfectSize: 6,
    rotationMs: ZONE_ROTATION_MS,
  };
}
export const zoneAngle = (elapsedMs: number, rotationMs: number) =>
  ((Math.max(0, elapsedMs) / rotationMs) * 360) % 360;
export function zonePlayerAngle(player: ZonePlayer, elapsedMs: number) {
  const attempt = player.lastAttempt;
  if (player.resumeAt !== null && attempt && elapsedMs < attempt.elapsedMs + ZONE_PAUSE_MS)
    return attempt.angle;
  return zoneAngle(elapsedMs - player.pausedMs, player.target!.check.rotationMs);
}
export function zoneGrade(check: ZoneCheck, angle: number): ZoneGrade {
  const center = (check.zoneStart + check.zoneSize / 2) % 360;
  const difference = Math.abs((((angle % 360) + 360) % 360) - center);
  const distance = Math.min(difference, 360 - difference);
  return distance <= check.perfectSize / 2
    ? "perfect"
    : distance <= check.zoneSize / 2
      ? "hit"
      : "miss";
}
export function createZoneMatch(roundId: string): ZoneMatch {
  return {
    phase: "lobby",
    roundId,
    players: [],
    matchNumber: 1,
    startsAt: null,
    finishedAt: null,
    winnerId: null,
  };
}
export function addZonePlayer(match: ZoneMatch, id: string, name: string) {
  if (
    match.phase !== "lobby" ||
    match.players.length >= ZONE_MAX_PLAYERS ||
    match.players.some((player) => player.id === id)
  )
    throw new Error("За столом нет свободных мест.");
  match.players.push({
    id,
    name,
    score: 0,
    points: 0,
    attempts: 0,
    target: null,
    lastAttempt: null,
    pausedMs: 0,
    resumeAt: null,
    pendingTarget: null,
    ready: false,
    connected: false,
  });
  for (const player of match.players) player.ready = false;
}
export function advanceZone(match: ZoneMatch, now: number) {
  if (match.phase === "countdown" && now >= match.startsAt!) match.phase = "running";
  if (match.phase !== "running") return;
  for (const player of match.players) {
    if (player.resumeAt === null || now < player.resumeAt) continue;
    player.target = player.pendingTarget!;
    player.pendingTarget = null;
    player.resumeAt = null;
  }
}
export function applyZoneCommand(
  match: ZoneMatch,
  playerId: string,
  command: ZoneCommand,
  now: number,
  nextRoundId: string,
  newTarget: ZoneTargetFactory,
) {
  advanceZone(match, now);
  const player = match.players.find((p) => p.id === playerId);
  if (!player || !player.connected) throw new Error("Игрок не подключён.");
  if (command.roundId !== match.roundId) throw new Error("Матч уже сменился.");
  if (command.type === "hit") {
    if (match.phase !== "running" || !player.target) throw new Error("Сейчас нажать нельзя.");
    if (player.resumeAt !== null) throw new Error("Дождись конца короткой паузы.");
    if (command.checkId !== player.target.id) throw new Error("Сектор уже сменился.");
    const elapsed = command.elapsedMs;
    if (
      typeof elapsed !== "number" ||
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      (player.lastAttempt !== null && elapsed < player.lastAttempt.elapsedMs + ZONE_PAUSE_MS) ||
      Math.abs(elapsed - (now - match.startsAt!)) > ZONE_TIMING_ALLOWANCE_MS
    )
      throw new Error("Время не совпало с сервером. Проверь соединение.");
    const angle = zonePlayerAngle(player, elapsed);
    const grade = zoneGrade(player.target.check, angle);
    const points =
      grade === "perfect" ? ZONE_HIT_POINTS * 2 : grade === "hit" ? ZONE_HIT_POINTS : 0;
    const progress = Math.min(ZONE_GOAL, player.points + points);
    const target = progress === ZONE_GOAL ? player.target : newTarget(player.target.check);
    player.attempts += 1;
    player.lastAttempt = { elapsedMs: elapsed, angle, grade, points };
    player.points = progress;
    if (player.points === ZONE_GOAL) {
      match.phase = "complete";
      match.finishedAt = now;
      match.winnerId = player.id;
      player.score += 1;
      for (const participant of match.players) participant.ready = false;
    } else {
      player.pendingTarget = target;
      player.resumeAt = match.startsAt! + elapsed + ZONE_PAUSE_MS;
      player.pausedMs += ZONE_PAUSE_MS;
    }
    return;
  }
  if (
    (command.type !== "ready" || match.phase !== "lobby") &&
    (command.type !== "rematch" || match.phase !== "complete")
  )
    throw new Error("Действие сейчас недоступно.");
  if (match.players.length < ZONE_MIN_PLAYERS || match.players.some((p) => !p.connected))
    throw new Error("Дождись подключения всех участников.");
  player.ready = true;
  if (!match.players.every((p) => p.ready)) return;
  const targets = match.players.map(() => newTarget());
  if (command.type === "rematch") match.matchNumber += 1;
  match.roundId = nextRoundId;
  match.startsAt = now + 3000;
  match.finishedAt = null;
  match.winnerId = null;
  match.phase = "countdown";
  match.players.forEach((p, index) => {
    p.points = 0;
    p.attempts = 0;
    p.lastAttempt = null;
    p.pausedMs = 0;
    p.resumeAt = null;
    p.pendingTarget = null;
    p.target = targets[index];
    p.ready = false;
  });
}
export function zonePublicState(match: ZoneMatch): ZoneMatch {
  return {
    ...match,
    players: match.players.map((p) => ({
      ...p,
      target: p.target ? { id: p.target.id, check: { ...p.target.check } } : null,
      pendingTarget: p.pendingTarget
        ? { id: p.pendingTarget.id, check: { ...p.pendingTarget.check } }
        : null,
      lastAttempt: p.lastAttempt ? { ...p.lastAttempt } : null,
    })),
  };
}
