import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";

export const SHOOTING_DURATION_MS = 30000;
export const SHOOTING_COUNTDOWN_MS = 3000;
export const SHOOTING_COOLDOWN_MS = 160;
export const SHOOTING_MIN_PLAYERS = 2;
export const SHOOTING_MAX_PLAYERS = 12;
export const SHOOTING_ARENA_HEIGHT_RATIO = 0.36;
export interface ShootingCursor {
  x: number;
  y: number;
  seq: number;
  updatedAt: number;
}
export interface ShootingCursorInput {
  x: number;
  y: number;
  seq: number;
}
export interface ShootingPlayer extends MinigamePlayer {
  points: number;
  shots: number;
  hits: number;
  traps: number;
  lastShotAt: number | null;
  cursor: ShootingCursor | null;
}
export type ShootingTargetKind = "normal" | "bonus" | "gold" | "trap";
export interface ShootingTarget {
  id: string;
  x: number;
  y: number;
  radius: number;
  kind: ShootingTargetKind;
  points: 10 | 25 | 50 | -30;
  spawnedAt: number;
  expiresAt: number;
}
export interface ShootingEffect {
  id: string;
  targetId: string | null;
  playerId: string;
  x: number;
  y: number;
  points: number;
  at: number;
}
export interface ShootingCommand extends MinigameCommand {
  type: "ready" | "shoot" | "rematch";
  targetId?: string;
  x?: number;
  y?: number;
}
export interface ShootingSnapshot extends MinigameSnapshot {
  phase: "lobby" | "countdown" | "running" | "complete";
  players: ShootingPlayer[];
  targets: ShootingTarget[];
  effects: ShootingEffect[];
  matchNumber: number;
  startsAt: number | null;
  endsAt: number | null;
  winnerIds: string[];
}
export interface ShootingMatch extends Omit<
  ShootingSnapshot,
  "id" | "code" | "revision" | "serverTime"
> {
  nextSpawnAt: number | null;
}
type RandomIndex = (upper: number) => number;
type IdFactory = () => string;
const specifications = {
  normal: { points: 10, radius: 0.06 },
  bonus: { points: 25, radius: 0.05 },
  gold: { points: 50, radius: 0.04 },
  trap: { points: -30, radius: 0.055 },
} as const;
const coordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
function random(randomIndex: RandomIndex, upper: number) {
  const value = randomIndex(upper);
  if (!Number.isSafeInteger(value) || value < 0 || value >= upper)
    throw new Error("Неверный источник случайных чисел.");
  return value;
}
export function createShootingMatch(roundId: string): ShootingMatch {
  return {
    phase: "lobby",
    roundId,
    players: [],
    targets: [],
    effects: [],
    matchNumber: 1,
    startsAt: null,
    endsAt: null,
    winnerIds: [],
    nextSpawnAt: null,
  };
}
export function addShootingPlayer(match: ShootingMatch, id: string, name: string) {
  if (match.phase !== "lobby") throw new Error("Матч уже начался.");
  if (match.players.length >= SHOOTING_MAX_PLAYERS) throw new Error("Все места уже заняты.");
  if (match.players.some((p) => p.id === id)) throw new Error("Игрок уже за столом.");
  match.players.push({
    id,
    name,
    score: 0,
    ready: false,
    connected: false,
    points: 0,
    shots: 0,
    hits: 0,
    traps: 0,
    lastShotAt: null,
    cursor: null,
  });
  for (const player of match.players) player.ready = false;
}
function spawn(
  match: ShootingMatch,
  now: number,
  randomIndex: RandomIndex,
  idFactory: IdFactory,
  forcedKind?: ShootingTargetKind,
) {
  if (match.targets.length >= 8) return;
  const roll = random(randomIndex, 100);
  const kind =
    forcedKind ?? (roll < 55 ? "normal" : roll < 80 ? "bonus" : roll < 90 ? "gold" : "trap");
  const { radius, points } = specifications[kind];
  const minY = (radius + 0.01) / SHOOTING_ARENA_HEIGHT_RATIO;
  const maxY = 1 - (radius + 0.03) / SHOOTING_ARENA_HEIGHT_RATIO;
  for (let attempt = 0; attempt < 60; attempt++) {
    const x = 0.09 + random(randomIndex, 8201) / 10000;
    const y = minY + (random(randomIndex, 10001) / 10000) * (maxY - minY);
    if (
      match.targets.some(
        (target) =>
          Math.hypot(x - target.x, (y - target.y) * SHOOTING_ARENA_HEIGHT_RATIO) <
          Math.max(radius + target.radius + 0.025, 0.14),
      )
    )
      continue;
    match.targets.push({
      id: idFactory(),
      x,
      y,
      radius,
      kind,
      points,
      spawnedAt: now,
      expiresAt: Math.min(match.endsAt!, now + 1800 + random(randomIndex, 1701)),
    });
    return;
  }
}
function finish(match: ShootingMatch) {
  const maximum = Math.max(...match.players.map((p) => p.points));
  match.winnerIds =
    maximum > 0 ? match.players.filter((p) => p.points === maximum).map((p) => p.id) : [];
  for (const player of match.players) {
    if (match.winnerIds.includes(player.id)) player.score++;
    player.ready = false;
  }
  match.phase = "complete";
  match.targets = [];
  match.effects = [];
  match.nextSpawnAt = null;
}
export function advanceShooting(
  match: ShootingMatch,
  now: number,
  randomIndex: RandomIndex,
  idFactory: IdFactory,
) {
  if (match.phase === "countdown") {
    if (now < match.startsAt! && match.players.some((p) => !p.connected)) {
      match.phase = "lobby";
      match.startsAt = match.endsAt = null;
      for (const player of match.players) player.ready = false;
      return;
    }
    if (now < match.startsAt!) return;
    match.phase = "running";
    if (now < match.endsAt!) {
      let best: ShootingTarget[] = [];
      for (let attempt = 0; attempt < 8; attempt++) {
        match.targets = [];
        for (const kind of [
          "normal",
          "bonus",
          "gold",
          "trap",
          "normal",
          "normal",
          "bonus",
        ] as const)
          spawn(match, now, randomIndex, idFactory, kind);
        if (match.targets.length > best.length) best = match.targets;
        if (best.length === 7) break;
      }
      match.targets = best;
      match.nextSpawnAt = now + 500;
    }
  }
  if (match.phase !== "running") return;
  if (now >= match.endsAt!) {
    finish(match);
    return;
  }
  match.targets = match.targets.filter((target) => target.expiresAt > now);
  match.effects = match.effects.filter((effect) => now - effect.at < 1200).slice(-24);
  if (match.nextSpawnAt !== null && now >= match.nextSpawnAt) {
    spawn(match, now, randomIndex, idFactory);
    match.nextSpawnAt = now + 500;
  }
}
export function applyShootingCommand(
  match: ShootingMatch,
  playerId: string,
  command: ShootingCommand,
  now: number,
  nextRoundId: string,
  randomIndex: RandomIndex,
  idFactory: IdFactory,
) {
  advanceShooting(match, now, randomIndex, idFactory);
  const player = match.players.find((p) => p.id === playerId);
  if (!player || !player.connected) throw new Error("Игрок не подключён.");
  if (command.roundId !== match.roundId) throw new Error("Матч уже сменился.");
  if (command.type === "shoot") {
    if (match.phase !== "running") throw new Error("Дождись начала матча.");
    if (!coordinate(command.x) || !coordinate(command.y))
      throw new Error("Неверное положение выстрела.");
    if (player.lastShotAt !== null && now - player.lastShotAt < SHOOTING_COOLDOWN_MS)
      throw new Error("Слишком частые выстрелы.");
    player.lastShotAt = now;
    player.shots++;
    const target = match.targets.find((candidate) => candidate.id === command.targetId);
    const points = target?.points ?? 0;
    if (target) {
      match.targets = match.targets.filter((candidate) => candidate.id !== target.id);
      player.points += points;
      if (points > 0) player.hits++;
      else player.traps++;
    }
    match.effects.push({
      id: idFactory(),
      targetId: target?.id ?? null,
      playerId,
      x: target?.x ?? command.x,
      y: target?.y ?? command.y,
      points,
      at: now,
    });
    match.effects = match.effects.slice(-24);
    return;
  }
  if (
    (command.type !== "ready" || match.phase !== "lobby") &&
    (command.type !== "rematch" || match.phase !== "complete")
  )
    throw new Error("Действие сейчас недоступно.");
  if (match.players.length < SHOOTING_MIN_PLAYERS || match.players.some((p) => !p.connected))
    throw new Error("Дождись всех участников.");
  player.ready = true;
  if (!match.players.every((p) => p.ready)) return;
  if (command.type === "rematch") match.matchNumber++;
  match.roundId = nextRoundId;
  match.phase = "countdown";
  match.startsAt = now + SHOOTING_COUNTDOWN_MS;
  match.endsAt = match.startsAt + SHOOTING_DURATION_MS;
  match.winnerIds = [];
  match.targets = [];
  match.effects = [];
  match.nextSpawnAt = null;
  for (const p of match.players) {
    p.points = p.shots = p.hits = p.traps = 0;
    p.lastShotAt = null;
    p.cursor = null;
    p.ready = false;
  }
}
export function applyShootingCursor(
  match: ShootingMatch,
  playerId: string,
  input: ShootingCursorInput,
  now: number,
) {
  const player = match.players.find((p) => p.id === playerId);
  if (!player?.connected || (match.phase !== "running" && match.phase !== "countdown")) return;
  if (
    !coordinate(input.x) ||
    !coordinate(input.y) ||
    !Number.isSafeInteger(input.seq) ||
    input.seq < 0
  )
    return;
  if (player.cursor && input.seq <= player.cursor.seq) return;
  player.cursor = { ...input, updatedAt: now };
}
export function shootingPublicState(
  match: ShootingMatch,
): Omit<ShootingSnapshot, "id" | "code" | "revision" | "serverTime"> {
  return {
    phase: match.phase,
    roundId: match.roundId,
    matchNumber: match.matchNumber,
    startsAt: match.startsAt,
    endsAt: match.endsAt,
    players: match.players.map((p) => ({ ...p, cursor: p.cursor ? { ...p.cursor } : null })),
    targets: match.targets.map((t) => ({ ...t })),
    effects: match.effects.map((e) => ({ ...e })),
    winnerIds: [...match.winnerIds],
  };
}
