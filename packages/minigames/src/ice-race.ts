import type { FallingFloorCommand, FallingFloorInput } from "./falling-floor";
import { resolvePlayerCollisions, type FloorMotionPath } from "./falling-floor-collisions";
import type { MinigamePlayer, MinigameSnapshot } from "./session";
import {
  crossesIceCheckpoint,
  ICE_CHECKPOINT_POINTS,
  iceCheckpoints,
  iceStartPosition,
  isOnIceTrack,
  type IcePoint,
} from "./ice-track";

export const ICE_RACE_MAX_PLAYERS = 12;
export const ICE_RACE_DURATION_MS = 45_000;
export const ICE_RACE_TICK_MS = 40;
const COUNTDOWN_MS = 3000;
const STEP_MS = 20;
const INPUT_TIMEOUT_MS = 260;
const RESPAWN_MS = 700;
const MAX_SPEED = 260;
const ACCELERATION = 550;
// The shared contact solver works in tiles. The ice track uses finer coordinates.
const ICE_UNITS_PER_TILE = 32;

export type IceRaceInput = FallingFloorInput;
export type IceRaceCommand = FallingFloorCommand;

export interface IceRacer extends MinigamePlayer, IcePoint {
  points: number;
  nextCheckpoint: number;
  inputSeq: number;
  angle: number;
  speed: number;
  respawnAt: number | null;
}

export interface IceRaceSnapshot extends MinigameSnapshot {
  phase: "lobby" | "countdown" | "running" | "complete";
  players: IceRacer[];
  startsAt: number | null;
  endsAt: number | null;
  winnerIds: string[];
  matchNumber: number;
}

type Control = { dx: number; dy: number; at: number };
type RacerMotion = { vx: number; vy: number; input: Control | null };
type RacerPath = FloorMotionPath & { player: IceRacer };
type IceRaceView = Omit<IceRaceSnapshot, "id" | "code" | "revision" | "serverTime">;
export interface IceRaceMatch extends IceRaceView {
  simulatedAt: number | null;
  motion: Record<string, RacerMotion>;
}

export function createIceRace(roundId: string): IceRaceMatch {
  return {
    roundId,
    phase: "lobby",
    players: [],
    startsAt: null,
    endsAt: null,
    winnerIds: [],
    matchNumber: 1,
    simulatedAt: null,
    motion: {},
  };
}

function startingState(index: number) {
  return {
    ...iceStartPosition(index),
    ready: false,
    points: 0,
    nextCheckpoint: 0,
    inputSeq: -1,
    angle: -90,
    speed: 0,
    respawnAt: null,
  };
}

export function addIceRacer(match: IceRaceMatch, id: string, name: string) {
  if (
    match.phase !== "lobby" ||
    match.players.length >= ICE_RACE_MAX_PLAYERS ||
    match.players.some((p) => p.id === id)
  )
    throw new Error("На трассе нет свободных мест.");
  match.players.push({
    id,
    name,
    connected: false,
    score: 0,
    ...startingState(match.players.length),
  });
  for (const player of match.players) player.ready = false;
}

function planRacerPath(
  player: IceRacer,
  motion: RacerMotion,
  at: number,
  index: number,
  dt: number,
): RacerPath | null {
  if (player.respawnAt !== null) {
    if (at < player.respawnAt) return null;
    const previous =
      iceCheckpoints[(player.nextCheckpoint + iceCheckpoints.length - 1) % iceCheckpoints.length];
    const position = player.points ? previous : iceStartPosition(index);
    Object.assign(player, { x: position.x, y: position.y, respawnAt: null });
    motion.input = null;
    return null;
  }

  const input =
    player.connected && motion.input && at - motion.input.at <= INPUT_TIMEOUT_MS
      ? motion.input
      : null;
  const norm = Math.max(1, Math.hypot(input?.dx ?? 0, input?.dy ?? 0));
  // Steering adds velocity without cancelling momentum from the previous direction.
  const drag = Math.exp(-1.25 * dt);
  const vx = motion.vx * drag + ((input?.dx ?? 0) / norm) * ACCELERATION * dt;
  const vy = motion.vy * drag + ((input?.dy ?? 0) / norm) * ACCELERATION * dt;
  const speed = Math.hypot(vx, vy);
  const capped = Math.min(1, MAX_SPEED / Math.max(1, speed));
  const x = player.x / ICE_UNITS_PER_TILE;
  const y = player.y / ICE_UNITS_PER_TILE;
  const tileVx = (vx * capped) / ICE_UNITS_PER_TILE;
  const tileVy = (vy * capped) / ICE_UNITS_PER_TILE;
  return {
    player,
    x,
    y,
    endX: x + (speed >= 2 ? tileVx * dt : 0),
    endY: y + (speed >= 2 ? tileVy * dt : 0),
    vx: tileVx,
    vy: tileVy,
    fall: null,
  };
}

function commitRacerPath(path: RacerPath, motion: RacerMotion, at: number) {
  const { player } = path;
  const next = { x: path.endX * ICE_UNITS_PER_TILE, y: path.endY * ICE_UNITS_PER_TILE };
  if (!isOnIceTrack(next)) {
    player.respawnAt = at + RESPAWN_MS;
    player.speed = motion.vx = motion.vy = 0;
    return;
  }
  // The impulse becomes part of the runner's velocity and decays with the ice friction.
  motion.vx = path.vx * ICE_UNITS_PER_TILE;
  motion.vy = path.vy * ICE_UNITS_PER_TILE;
  player.speed = Math.hypot(motion.vx, motion.vy);
  if (player.speed >= 2) player.angle = (Math.atan2(motion.vy, motion.vx) * 180) / Math.PI;
  if (crossesIceCheckpoint(player, next, player.nextCheckpoint)) {
    player.points += ICE_CHECKPOINT_POINTS;
    player.nextCheckpoint = (player.nextCheckpoint + 1) % iceCheckpoints.length;
  }
  Object.assign(player, next);
}

export function advanceIceRace(match: IceRaceMatch, now: number) {
  if (match.phase === "countdown" && now >= match.startsAt!) {
    match.phase = "running";
    match.simulatedAt = match.startsAt;
  }
  if (match.phase !== "running") return;
  const end = Math.min(now, match.endsAt!);
  while (match.simulatedAt! + STEP_MS <= end) {
    const at = (match.simulatedAt! += STEP_MS);
    const paths = match.players
      .map((player, index) =>
        planRacerPath(player, match.motion[player.id], at, index, STEP_MS / 1000),
      )
      .filter((path) => path !== null);
    resolvePlayerCollisions(paths, {}, (position) => position);
    for (const path of paths) commitRacerPath(path, match.motion[path.player.id], at);
  }
  if (now < match.endsAt!) return;
  match.phase = "complete";
  const best = Math.max(...match.players.map((player) => player.points));
  match.winnerIds = match.players
    .filter((player) => player.points === best)
    .map((player) => player.id);
  for (const player of match.players) {
    if (match.winnerIds.includes(player.id)) player.score++;
    player.ready = false;
  }
}

export function applyIceRaceInput(
  match: IceRaceMatch,
  playerId: string,
  input: IceRaceInput,
  now: number,
) {
  if (match.phase !== "running" || now >= match.endsAt! || input.roundId !== match.roundId)
    return false;
  const player = match.players.find((entry) => entry.id === playerId);
  if (
    !player?.connected ||
    !Number.isSafeInteger(input.seq) ||
    input.seq <= player.inputSeq ||
    !Number.isFinite(input.dx) ||
    Math.abs(input.dx) > 1 ||
    !Number.isFinite(input.dy) ||
    Math.abs(input.dy) > 1
  )
    return false;
  advanceIceRace(match, now);
  player.inputSeq = input.seq;
  match.motion[playerId].input = { dx: input.dx, dy: input.dy, at: now };
  return true;
}

export function applyIceRaceCommand(
  match: IceRaceMatch,
  playerId: string,
  command: IceRaceCommand,
  now: number,
  nextRoundId: string,
) {
  advanceIceRace(match, now);
  const player = match.players.find((entry) => entry.id === playerId);
  if (!player?.connected || command.roundId !== match.roundId)
    throw new Error("Раунд сменился или игрок не на связи.");
  if (
    (command.type !== "ready" || match.phase !== "lobby") &&
    (command.type !== "rematch" || match.phase !== "complete")
  )
    throw new Error("Действие сейчас недоступно.");
  if (match.players.length < 2 || match.players.some((entry) => !entry.connected))
    throw new Error("Дождись всех участников.");
  player.ready = true;
  if (!match.players.every((entry) => entry.ready)) return;
  const { players, matchNumber } = match;
  Object.assign(match, createIceRace(nextRoundId), {
    players,
    matchNumber: matchNumber + Number(command.type === "rematch"),
  });
  players.forEach((entry, index) => {
    Object.assign(entry, startingState(index));
    match.motion[entry.id] = { vx: 0, vy: 0, input: null };
  });
  match.phase = "countdown";
  match.startsAt = now + COUNTDOWN_MS;
  match.endsAt = match.startsAt + ICE_RACE_DURATION_MS;
}

export function iceRacePublicState(match: IceRaceMatch): IceRaceView {
  const { phase, roundId, players, startsAt, endsAt, winnerIds, matchNumber } = match;
  return {
    phase,
    roundId,
    players: players.map((player) => ({ ...player })),
    startsAt,
    endsAt,
    winnerIds: [...winnerIds],
    matchNumber,
  };
}
