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
  rail?: "rear" | "front";
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
const railPositions = [0.155, 0.385, 0.615, 0.845];
const openingTargets = ["gold", "normal", "normal", "normal", "bonus", "bonus", "trap"] as const;

export function shootingTargetPose(target: ShootingTarget, now: number) {
  const elapsed = Math.max(0, now - target.spawnedAt);
  const x =
    target.kind === "bonus" && target.rail ? target.x + 0.065 * Math.sin(now / 490) : target.x;
  // The two shutters meet in the middle, pause, then retract together.
  const opening =
    target.kind === "gold" && target.rail
      ? Math.max(0, Math.min(1, 0.55 + 0.9 * Math.cos(elapsed / 245)))
      : 1;
  return { x, opening, exposed: opening >= 0.45 };
}

function spawnDelay(match: ShootingMatch) {
  return Math.max(180, 520 - 65 * (match.players.filter((player) => player.connected).length - 2));
}

function spawn(
  match: ShootingMatch,
  now: number,
  randomIndex: RandomIndex,
  idFactory: IdFactory,
  forcedKind?: ShootingTargetKind,
) {
  const free = (rail: "rear" | "front") =>
    railPositions.filter(
      (x) => !match.targets.some((target) => target.rail === rail && target.x === x),
    );
  const rear = free("rear"),
    front = free("front");
  if (!rear.length && !front.length) return;
  const roll = random(randomIndex, 100);
  let kind =
    forcedKind ?? (roll < 48 ? "normal" : roll < 78 ? "bonus" : roll < 90 ? "gold" : "trap");
  if (kind === "gold" && match.targets.some((target) => target.kind === "gold")) kind = "normal";
  if (!rear.length && (kind === "gold" || kind === "normal")) kind = "bonus";
  if (!front.length && (kind === "bonus" || kind === "trap")) kind = "normal";
  const rail = kind === "normal" || kind === "gold" ? "rear" : "front";
  const slots = rail === "rear" ? rear : front;
  match.targets.push({
    id: idFactory(),
    kind,
    rail,
    x: slots[random(randomIndex, slots.length)],
    y: rail === "rear" ? 0.32 : 0.73,
    ...specifications[kind],
    spawnedAt: now,
    expiresAt: Math.min(match.endsAt!, now + 1800 + random(randomIndex, 1701)),
  });
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
      for (const kind of openingTargets) spawn(match, now, randomIndex, idFactory, kind);
      match.nextSpawnAt = now + spawnDelay(match);
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
    match.nextSpawnAt = now + spawnDelay(match);
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
    const target = match.targets.find(
      (candidate) =>
        candidate.id === command.targetId && shootingTargetPose(candidate, now).exposed,
    );
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
      x: command.x,
      y: command.y,
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
