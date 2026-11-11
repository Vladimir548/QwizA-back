import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";
import {
  PLAYER_BUMP_DRAG,
  resolvePlayerCollisions,
  type FloorVelocity,
} from "./falling-floor-collisions";

export const ROCKFALL_MAX_PLAYERS = 12;
export const ROCKFALL_WIDTH = 9.6;
export const ROCKFALL_HEIGHT = 6;
export const ROCKFALL_SPEED = 3.6;
export const ROCKFALL_BODY_HEIGHT = 1.02;
export const ROCKFALL_RADIUS = 0.28;
export const ROCKFALL_GRAVITY = 18;
export const ROCKFALL_JUMP_SPEED = 8.2;
export const ROCKFALL_INPUT_TIMEOUT = 250;
const STEP_MS = 20;

export interface RockfallPlayer extends MinigamePlayer {
  x: number;
  y: number;
  vy: number;
  alive: boolean;
  eliminatedAt: number | null;
  inputSeq: number;
  jumpSeq: number;
}
export interface FallingRock {
  id: number;
  x: number;
  y: number;
  radius: number;
  vy: number;
  dropsAt: number;
}
export interface RockfallInput {
  roundId: string;
  seq: number;
  dx: number;
  jumpSeq: number;
}
export interface RockfallCommand extends MinigameCommand {
  type: "ready" | "rematch";
}
export interface RockfallSnapshot extends MinigameSnapshot {
  phase: "lobby" | "countdown" | "running" | "complete";
  players: RockfallPlayer[];
  rocks: FallingRock[];
  startsAt: number | null;
  endedAt: number | null;
  elapsedMs: number;
  difficulty: number;
  winnerIds: string[];
  matchNumber: number;
}
export interface RockfallMatch extends Omit<
  RockfallSnapshot,
  "id" | "code" | "revision" | "serverTime"
> {
  simulatedAt: number | null;
  nextRockAt: number | null;
  nextRockId: number;
  inputs: Record<string, { dx: number; at: number; jumpSeq: number }>;
  bumps: Record<string, FloorVelocity>;
}
const clamp = (x: number) =>
  Math.max(ROCKFALL_RADIUS, Math.min(ROCKFALL_WIDTH - ROCKFALL_RADIUS, x));
const spawn = (index: number) => 0.55 + ((index * 5) % 12) * ((ROCKFALL_WIDTH - 1.1) / 11);
export function createRockfallMatch(roundId: string): RockfallMatch {
  return {
    phase: "lobby",
    roundId,
    players: [],
    rocks: [],
    startsAt: null,
    endedAt: null,
    elapsedMs: 0,
    difficulty: 1,
    winnerIds: [],
    matchNumber: 1,
    simulatedAt: null,
    nextRockAt: null,
    nextRockId: 0,
    inputs: {},
    bumps: {},
  };
}
export function addRockfallPlayer(match: RockfallMatch, id: string, name: string) {
  if (
    match.phase !== "lobby" ||
    match.players.length >= ROCKFALL_MAX_PLAYERS ||
    match.players.some((p) => p.id === id)
  )
    throw new Error("За столом нет свободных мест.");
  match.players.push({
    id,
    name,
    score: 0,
    ready: false,
    connected: false,
    x: spawn(match.players.length),
    y: 0,
    vy: 0,
    alive: true,
    eliminatedAt: null,
    inputSeq: -1,
    jumpSeq: 0,
  });
  for (const p of match.players) p.ready = false;
}
function finish(match: RockfallMatch, now: number) {
  const alive = match.players.filter((p) => p.alive);
  if (alive.length > 1) return;
  match.phase = "complete";
  match.endedAt = now;
  match.winnerIds = alive.map((p) => p.id);
  match.nextRockAt = null;
  match.inputs = {};
  match.bumps = {};
  for (const p of match.players) {
    p.ready = false;
    if (p.alive) p.score++;
  }
}
function randomUnit(randomIndex: (upper: number) => number) {
  const value = randomIndex(10000);
  if (!Number.isInteger(value) || value < 0 || value >= 10000)
    throw new Error("Неверный источник случайных чисел.");
  return value / 10000;
}
function spawnRocks(match: RockfallMatch, at: number, randomIndex: (upper: number) => number) {
  const seconds = (at - match.startsAt!) / 1000;
  match.difficulty = 1 + Math.floor(seconds / 15);
  const count = Math.min(3, 1 + Math.floor(seconds / 30));
  for (let index = 0; index < count; index++)
    match.rocks.push({
      id: ++match.nextRockId,
      x: 0.4 + randomUnit(randomIndex) * (ROCKFALL_WIDTH - 0.8),
      y: ROCKFALL_HEIGHT,
      radius: 0.23 + randomUnit(randomIndex) * 0.18,
      vy: -(3.3 + Math.min(4, seconds * 0.045)),
      dropsAt: at + 650,
    });
  match.nextRockAt = at + Math.max(240, 1150 - seconds * 13);
}
function step(match: RockfallMatch, from: number, to: number) {
  const dt = (to - from) / 1000,
    decay = Math.exp(-PLAYER_BUMP_DRAG * dt);
  const heights = new Map<string, number>();
  const paths = match.players
    .filter((p) => p.alive)
    .map((player) => {
      const input = match.inputs[player.id],
        dx = input && from < input.at + ROCKFALL_INPUT_TIMEOUT ? input.dx : 0;
      player.y = Math.max(0, player.y + player.vy * dt - (ROCKFALL_GRAVITY * dt * dt) / 2);
      player.vy = player.y > 0 ? player.vy - ROCKFALL_GRAVITY * dt : 0;
      heights.set(player.id, player.y);
      const bump = match.bumps[player.id] ?? { dx: 0, dy: 0 };
      const endX = clamp(
        player.x + dx * ROCKFALL_SPEED * dt + (bump.dx * (1 - decay)) / PLAYER_BUMP_DRAG,
      );
      match.bumps[player.id] = { dx: bump.dx * decay, dy: 0 };
      return {
        player,
        x: player.x,
        y: 0,
        endX,
        endY: 0,
        vx: dx * ROCKFALL_SPEED + bump.dx * decay,
        vy: 0,
        fall: null,
      };
    });
  resolvePlayerCollisions(
    paths,
    match.bumps,
    clamp,
    (a, b) =>
      Math.abs(heights.get(a.player.id)! - heights.get(b.player.id)!) < ROCKFALL_BODY_HEIGHT,
  );
  for (const path of paths) path.player.x = path.endX;
  for (const rock of match.rocks) {
    const moving = Math.max(0, (to - Math.max(from, rock.dropsAt)) / 1000);
    rock.y += rock.vy * moving - 2 * moving * moving;
    rock.vy -= 4 * moving;
  }
  // Resolve every hit in this step before deciding the winner: simultaneous hits can draw.
  for (const p of match.players)
    if (
      p.alive &&
      match.rocks.some(
        (r) =>
          r.dropsAt <= to &&
          Math.hypot(
            r.x - Math.max(p.x - ROCKFALL_RADIUS, Math.min(p.x + ROCKFALL_RADIUS, r.x)),
            r.y - Math.max(p.y, Math.min(p.y + ROCKFALL_BODY_HEIGHT, r.y)),
          ) <= r.radius,
      )
    ) {
      p.alive = false;
      p.eliminatedAt = to;
      delete match.inputs[p.id];
      delete match.bumps[p.id];
    }
  match.rocks = match.rocks.filter((r) => r.y > -1);
  match.elapsedMs = to - match.startsAt!;
  finish(match, to);
}
export function advanceRockfall(
  match: RockfallMatch,
  now: number,
  randomIndex: (upper: number) => number,
) {
  if (!Number.isFinite(now)) return;
  if (match.phase === "countdown" && now >= match.startsAt!) {
    match.phase = "running";
    match.simulatedAt = match.startsAt;
    match.nextRockAt = match.startsAt! + 800;
  }
  if (match.phase !== "running" || now < match.simulatedAt!) return;
  while (match.phase === "running" && match.simulatedAt! < now) {
    const from = match.simulatedAt!;
    if (match.nextRockAt !== null && from >= match.nextRockAt) spawnRocks(match, from, randomIndex);
    let to = Math.min(now, from + STEP_MS, match.nextRockAt ?? Infinity);
    for (const input of Object.values(match.inputs)) {
      const expiry = input.at + ROCKFALL_INPUT_TIMEOUT;
      if (expiry > from) to = Math.min(to, expiry);
    }
    step(match, from, to);
    match.simulatedAt = to;
  }
}
export function applyRockfallInput(
  match: RockfallMatch,
  id: string,
  input: RockfallInput,
  now: number,
  randomIndex: (upper: number) => number,
) {
  if (
    input.roundId !== match.roundId ||
    !Number.isSafeInteger(input.seq) ||
    input.seq < 0 ||
    !Number.isFinite(input.dx) ||
    Math.abs(input.dx) > 1 ||
    !Number.isSafeInteger(input.jumpSeq) ||
    input.jumpSeq < 0
  )
    return false;
  advanceRockfall(match, now, randomIndex);
  const player = match.players.find((p) => p.id === id);
  if (
    match.phase !== "running" ||
    !player?.alive ||
    !player.connected ||
    input.seq <= player.inputSeq ||
    now < match.simulatedAt!
  )
    return false;
  const previous = match.inputs[id];
  if (input.jumpSeq > player.jumpSeq && player.y === 0) player.vy = ROCKFALL_JUMP_SPEED;
  player.jumpSeq = Math.max(player.jumpSeq, input.jumpSeq);
  match.inputs[id] = {
    dx: input.dx,
    at: now,
    jumpSeq: Math.max(input.jumpSeq, previous?.jumpSeq ?? 0),
  };
  player.inputSeq = input.seq;
  return true;
}
export function rockfallPresenceChanged(
  match: RockfallMatch,
  now: number,
  randomIndex: (upper: number) => number,
) {
  advanceRockfall(match, now, randomIndex);
  if (match.phase === "countdown" && match.players.some((p) => !p.connected)) {
    match.phase = "lobby";
    match.startsAt = null;
    for (const p of match.players) p.ready = false;
  }
  for (const p of match.players) if (!p.connected && match.inputs[p.id]) match.inputs[p.id].dx = 0;
}
export function applyRockfallCommand(
  match: RockfallMatch,
  id: string,
  command: RockfallCommand,
  now: number,
  nextRoundId: string,
  randomIndex: (upper: number) => number,
) {
  advanceRockfall(match, now, randomIndex);
  const player = match.players.find((p) => p.id === id);
  if (!player?.connected || command.roundId !== match.roundId)
    throw new Error("Матч сменился или игрок не на связи.");
  if (
    (command.type !== "ready" || match.phase !== "lobby") &&
    (command.type !== "rematch" || match.phase !== "complete")
  )
    throw new Error("Действие сейчас недоступно.");
  if (match.players.length < 2 || match.players.some((p) => !p.connected))
    throw new Error("Дождись всех участников.");
  player.ready = true;
  if (!match.players.every((p) => p.ready)) return;
  const players = match.players,
    matchNumber = match.matchNumber + Number(command.type === "rematch");
  Object.assign(match, createRockfallMatch(nextRoundId), { players, matchNumber });
  for (const [index, p] of players.entries())
    Object.assign(p, {
      x: spawn(index),
      y: 0,
      vy: 0,
      alive: true,
      eliminatedAt: null,
      inputSeq: -1,
      jumpSeq: 0,
      ready: false,
    });
  match.phase = "countdown";
  match.startsAt = now + 3000;
}
export function rockfallPublicState(
  match: RockfallMatch,
): Omit<RockfallSnapshot, "id" | "code" | "revision" | "serverTime"> {
  return {
    phase: match.phase,
    roundId: match.roundId,
    players: match.players.map((p) => ({ ...p })),
    rocks: match.rocks.map((r) => ({ ...r })),
    startsAt: match.startsAt,
    endedAt: match.endedAt,
    elapsedMs: match.elapsedMs,
    difficulty: match.difficulty,
    winnerIds: [...match.winnerIds],
    matchNumber: match.matchNumber,
  };
}
