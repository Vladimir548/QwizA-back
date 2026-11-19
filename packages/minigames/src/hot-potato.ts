import type { FallingFloorCommand, FallingFloorInput } from "./falling-floor";
import {
  HOT_POTATO_DEPTH,
  HOT_POTATO_PLAYER_RADIUS,
  HOT_POTATO_WIDTH,
  moveHotPotatoPlayer,
} from "./hot-potato-arena";
import type { MinigamePlayer, MinigameSnapshot } from "./session";

export const HOT_POTATO_MAX_PLAYERS = 6;
export const HOT_POTATO_FUSE_MS = 10_000;
export const HOT_POTATO_TICK_MS = 40;
const STEP_MS = 20;
const SPEED = 4.3;
const INPUT_TIMEOUT_MS = 260;
const COUNTDOWN_MS = 3000;
const CONTACT_DISTANCE = HOT_POTATO_PLAYER_RADIUS * 2;
const spawns = [
  [7, 4],
  [13, 8],
  [13, 4.7],
  [7, 7.5],
  [10.2, 2.3],
  [10.2, 9.6],
] as const;

export type HotPotatoInput = FallingFloorInput;
export type HotPotatoCommand = FallingFloorCommand;

export interface HotPotatoPlayer extends MinigamePlayer {
  x: number;
  y: number;
  angle: number;
  speed: number;
  alive: boolean;
  eliminatedAt: number | null;
  inputSeq: number;
}
export interface HotPotatoSnapshot extends MinigameSnapshot {
  phase: "lobby" | "countdown" | "running" | "complete";
  players: HotPotatoPlayer[];
  startsAt: number | null;
  holderId: string | null;
  explodesAt: number | null;
  lastExplosion: { playerId: string; x: number; y: number; at: number } | null;
  winnerIds: string[];
  matchNumber: number;
}
type HotPotatoView = Omit<HotPotatoSnapshot, "id" | "code" | "revision" | "serverTime">;
export interface HotPotatoMatch extends HotPotatoView {
  simulatedAt: number;
  pausedCountdownMs: number;
  contacts: number[];
  inputs: Record<string, { dx: number; dy: number; at: number }>;
}
const randomPlayer = (count: number) => Math.floor(Math.random() * count);

export function createHotPotato(roundId: string): HotPotatoMatch {
  return {
    roundId,
    phase: "lobby",
    players: [],
    startsAt: null,
    holderId: null,
    explodesAt: null,
    lastExplosion: null,
    winnerIds: [],
    matchNumber: 1,
    simulatedAt: 0,
    pausedCountdownMs: COUNTDOWN_MS,
    inputs: {},
    contacts: [],
  };
}

function startingState(index: number) {
  const [x, y] = spawns[index];
  const angle = (Math.atan2(HOT_POTATO_DEPTH / 2 - y, HOT_POTATO_WIDTH / 2 - x) * 180) / Math.PI;
  return { x, y, angle, speed: 0, alive: true, eliminatedAt: null, inputSeq: -1, ready: false };
}

export function addHotPotatoPlayer(match: HotPotatoMatch, id: string, name: string) {
  if (
    match.phase !== "lobby" ||
    match.players.length >= HOT_POTATO_MAX_PLAYERS ||
    match.players.some((p) => p.id === id)
  )
    throw new Error("На площади нет свободных мест.");
  match.players.push({
    id,
    name,
    connected: false,
    score: 0,
    ...startingState(match.players.length),
  });
  for (const p of match.players) p.ready = false;
}

function carryOrFinish(match: HotPotatoMatch, at: number, randomIndex: (upper: number) => number) {
  const survivors = match.players.filter((p) => p.alive);
  if (survivors.length > 1) {
    match.holderId = survivors[randomIndex(survivors.length)].id;
    match.explodesAt = at + HOT_POTATO_FUSE_MS;
    return;
  }
  match.phase = "complete";
  match.holderId = null;
  match.explodesAt = null;
  match.winnerIds = survivors.map((p) => p.id);
  for (const p of match.players) {
    if (p.alive) p.score++;
    p.speed = 0;
    p.ready = false;
  }
  match.inputs = {};
}

function movePlayers(match: HotPotatoMatch, at: number) {
  for (const p of match.players) {
    if (!p.alive) continue;
    const input = match.inputs[p.id];
    if (!p.connected || !input || at - input.at > INPUT_TIMEOUT_MS) {
      p.speed = 0;
      continue;
    }
    const magnitude = Math.hypot(input.dx, input.dy);
    const step = (SPEED * STEP_MS) / (1000 * Math.max(1, magnitude));
    const { x, y } = p;
    moveHotPotatoPlayer(p, input.dx * step, input.dy * step);
    p.speed = (Math.hypot(p.x - x, p.y - y) * 1000) / STEP_MS;
    if (magnitude) p.angle = (Math.atan2(input.dy, input.dx) * 180) / Math.PI;
  }
}

function resolveContacts(match: HotPotatoMatch) {
  const touching: number[] = [];
  let nextHolder: string | null = null;
  for (let i = 0; i < match.players.length; i++) {
    const a = match.players[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < match.players.length; j++) {
      const b = match.players[j];
      if (!b.alive) continue;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      const key = i * HOT_POTATO_MAX_PLAYERS + j;
      const wasTouching = match.contacts.includes(key);
      // Remember the contact until the characters visibly separate. Bumping
      // against a wall or continuing to push cannot pass the bomb straight back.
      if (distance > CONTACT_DISTANCE + (wasTouching ? 0.12 : 0.001)) continue;
      touching.push(key);
      if (!wasTouching && nextHolder === null) {
        if (match.holderId === a.id) nextHolder = b.id;
        if (match.holderId === b.id) nextHolder = a.id;
      }
      if (distance >= CONTACT_DISTANCE) continue;
      const correction = (CONTACT_DISTANCE - distance) / 2;
      const nx = distance ? dx / distance : 1;
      const ny = distance ? dy / distance : 0;
      moveHotPotatoPlayer(a, -nx * correction, -ny * correction);
      moveHotPotatoPlayer(b, nx * correction, ny * correction);
    }
  }
  match.contacts = touching;
  if (nextHolder !== null) match.holderId = nextHolder;
}

export function advanceHotPotato(match: HotPotatoMatch, now: number, randomIndex = randomPlayer) {
  if (match.phase === "countdown" && match.startsAt !== null && now >= match.startsAt) {
    match.phase = "running";
    match.simulatedAt = match.startsAt;
    carryOrFinish(match, match.startsAt, randomIndex);
  }
  while (match.phase === "running" && match.simulatedAt + STEP_MS <= now) {
    const at = (match.simulatedAt += STEP_MS);
    movePlayers(match, at);
    if (at >= match.explodesAt!) {
      const holder = match.players.find((p) => p.id === match.holderId)!;
      holder.alive = false;
      holder.speed = 0;
      holder.eliminatedAt = at;
      match.lastExplosion = { playerId: holder.id, x: holder.x, y: holder.y, at };
      delete match.inputs[holder.id];
      carryOrFinish(match, at, randomIndex);
    } else {
      resolveContacts(match);
    }
  }
}

export function onHotPotatoPresenceChanged(match: HotPotatoMatch, now: number) {
  advanceHotPotato(match, now);
  for (const p of match.players) {
    if (p.connected) continue;
    delete match.inputs[p.id];
    p.speed = 0;
    p.ready = false;
  }
  if (match.phase !== "countdown") return;
  if (match.players.some((p) => !p.connected) && match.startsAt !== null) {
    match.pausedCountdownMs = Math.max(1000, match.startsAt - now);
    match.startsAt = null;
  } else if (match.players.every((p) => p.connected) && match.startsAt === null) {
    match.startsAt = now + match.pausedCountdownMs;
  }
}

export function applyHotPotatoInput(
  match: HotPotatoMatch,
  playerId: string,
  input: HotPotatoInput,
  now: number,
) {
  advanceHotPotato(match, now);
  const p = match.players.find((entry) => entry.id === playerId);
  if (
    match.phase !== "running" ||
    !p?.connected ||
    !p.alive ||
    input.roundId !== match.roundId ||
    !Number.isSafeInteger(input.seq) ||
    input.seq <= p.inputSeq ||
    !Number.isFinite(input.dx) ||
    Math.abs(input.dx) > 1 ||
    !Number.isFinite(input.dy) ||
    Math.abs(input.dy) > 1
  )
    return false;
  p.inputSeq = input.seq;
  match.inputs[playerId] = { dx: input.dx, dy: input.dy, at: now };
  return true;
}

export function applyHotPotatoCommand(
  match: HotPotatoMatch,
  playerId: string,
  command: HotPotatoCommand,
  now: number,
  nextRoundId: string,
) {
  advanceHotPotato(match, now);
  const player = match.players.find((p) => p.id === playerId);
  if (!player?.connected || command.roundId !== match.roundId)
    throw new Error("Раунд сменился или игрок не на связи.");
  if (
    (command.type !== "ready" || match.phase !== "lobby") &&
    (command.type !== "rematch" || match.phase !== "complete")
  )
    throw new Error("Действие сейчас недоступно.");
  if (match.players.length < 2 || match.players.some((p) => !p.connected))
    throw new Error("Дождись всех участников.");
  player.ready = true;
  if (!match.players.every((p) => p.ready)) return;
  const { players, matchNumber } = match;
  Object.assign(match, createHotPotato(nextRoundId), {
    players,
    matchNumber: matchNumber + Number(command.type === "rematch"),
    phase: "countdown",
    startsAt: now + COUNTDOWN_MS,
  });
  players.forEach((p, i) => Object.assign(p, startingState(i)));
}

export function hotPotatoPublicState(match: HotPotatoMatch): HotPotatoView {
  const { phase, roundId, startsAt, holderId, explodesAt, lastExplosion, winnerIds, matchNumber } =
    match;
  return {
    phase,
    roundId,
    startsAt,
    holderId,
    explodesAt,
    matchNumber,
    lastExplosion: lastExplosion && { ...lastExplosion },
    winnerIds: [...winnerIds],
    players: match.players.map((p) => ({ ...p })),
  };
}
