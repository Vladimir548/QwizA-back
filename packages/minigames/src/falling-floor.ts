import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";
import {
  FLOOR_BUMP_DRAG,
  resolveFloorCollisions,
  type FloorVelocity,
} from "./falling-floor-collisions";

export const FALLING_FLOOR_BOARD_SIZE = 8;
export const FALLING_FLOOR_MIN_PLAYERS = 2;
export const FALLING_FLOOR_MAX_PLAYERS = 12;
export const FALLING_FLOOR_COUNTDOWN_MS = 3000;
export const FALLING_FLOOR_GRACE_MS = 5000;
export const FALLING_FLOOR_WARNING_MS = 2000;
export const FALLING_FLOOR_SAFE_MS = 5000;
export const FALLING_FLOOR_INPUT_TIMEOUT_MS = 250;
export const FALLING_FLOOR_TICK_MS = 40;
export const FALLING_FLOOR_SPEED = 3;
export const FALLING_FLOOR_PLAYER_RADIUS = 0.2;
const STEP_MS = 20;

export interface FallingFloorPlayer extends MinigamePlayer {
  x: number;
  y: number;
  alive: boolean;
  eliminatedAt: number | null;
  inputSeq: number;
}
export interface FallingFloorTile {
  index: number;
  x: number;
  y: number;
  state: "safe" | "warning" | "gone";
  fallsAt: number | null;
}
export interface FallingFloorInput {
  roundId: string;
  seq: number;
  dx: number;
  dy: number;
}
export interface FallingFloorCommand extends MinigameCommand {
  type: "ready" | "rematch";
}
export interface FallingFloorSnapshot extends MinigameSnapshot {
  phase: "lobby" | "countdown" | "running" | "complete";
  players: FallingFloorPlayer[];
  tiles: FallingFloorTile[];
  startsAt: number | null;
  nextWaveAt: number | null;
  wave: number;
  winnerIds: string[];
  endedAt: number | null;
  matchNumber: number;
}
interface MovementInput {
  dx: number;
  dy: number;
  at: number;
}
export interface FallingFloorMatch extends Omit<
  FallingFloorSnapshot,
  "id" | "code" | "revision" | "serverTime"
> {
  simulatedAt: number | null;
  inputs: Record<string, MovementInput>;
  knockbacks: Record<string, FloorVelocity>;
}

const spawns = [
  [2.5, 2.5],
  [5.5, 5.5],
  [5.5, 2.5],
  [2.5, 5.5],
  [3.5, 3.5],
  [4.5, 4.5],
  [1.5, 1.5],
  [6.5, 6.5],
  [6.5, 1.5],
  [1.5, 6.5],
  [3.5, 4.5],
  [4.5, 3.5],
] as const;
const clamp = (value: number) =>
  Math.min(
    FALLING_FLOOR_BOARD_SIZE - FALLING_FLOOR_PLAYER_RADIUS,
    Math.max(FALLING_FLOOR_PLAYER_RADIUS, value),
  );
const axis = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1;
function tiles(): FallingFloorTile[] {
  return Array.from({ length: FALLING_FLOOR_BOARD_SIZE ** 2 }, (_, index) => ({
    index,
    x: index % FALLING_FLOOR_BOARD_SIZE,
    y: Math.floor(index / FALLING_FLOOR_BOARD_SIZE),
    state: "safe",
    fallsAt: null,
  }));
}
export function createFallingFloorMatch(roundId: string): FallingFloorMatch {
  return {
    phase: "lobby",
    roundId,
    players: [],
    tiles: tiles(),
    startsAt: null,
    nextWaveAt: null,
    wave: 0,
    winnerIds: [],
    endedAt: null,
    matchNumber: 1,
    simulatedAt: null,
    inputs: {},
    knockbacks: {},
  };
}
export function addFallingFloorPlayer(match: FallingFloorMatch, id: string, name: string) {
  if (
    match.phase !== "lobby" ||
    match.players.length >= FALLING_FLOOR_MAX_PLAYERS ||
    match.players.some((player) => player.id === id)
  )
    throw new Error("За столом нет свободных мест.");
  const [x, y] = spawns[match.players.length];
  match.players.push({
    id,
    name,
    score: 0,
    ready: false,
    connected: false,
    x,
    y,
    alive: true,
    eliminatedAt: null,
    inputSeq: -1,
  });
  for (const player of match.players) player.ready = false;
}
function isGone(match: FallingFloorMatch, x: number, y: number) {
  return match.tiles[Math.floor(y) * FALLING_FLOOR_BOARD_SIZE + Math.floor(x)].state === "gone";
}
function finishIfDecided(match: FallingFloorMatch, now: number) {
  const alive = match.players.filter((player) => player.alive);
  if (alive.length > 1) return;
  match.winnerIds = alive.map((player) => player.id);
  for (const player of match.players) {
    if (match.winnerIds.includes(player.id)) player.score++;
    player.ready = false;
  }
  match.phase = "complete";
  match.endedAt = now;
  match.nextWaveAt = null;
  match.inputs = {};
  match.knockbacks = {};
}
function eliminateOnGone(match: FallingFloorMatch, now: number) {
  // Resolve the entire collapse together, so simultaneous last falls are a draw.
  for (const player of match.players)
    if (player.alive && isGone(match, player.x, player.y)) {
      player.alive = false;
      player.eliminatedAt = now;
      delete match.knockbacks[player.id];
    }
  finishIfDecided(match, now);
}
function waveEvents(match: FallingFloorMatch, now: number, randomIndex: (upper: number) => number) {
  const falling = match.tiles.filter((tile) => tile.state === "warning" && tile.fallsAt! <= now);
  if (falling.length) {
    for (const tile of falling) tile.state = "gone";
    eliminateOnGone(match, now);
    if (match.phase === "complete") return;
    match.nextWaveAt = now + FALLING_FLOOR_SAFE_MS;
  }
  if (match.nextWaveAt === null || now < match.nextWaveAt) return;
  const safe = match.tiles.filter((tile) => tile.state === "safe");
  const count =
    safe.length === 1 ? 1 : Math.min(safe.length - 1, Math.max(1, Math.ceil(safe.length * 0.18)));
  for (let index = 0; index < count; index++) {
    const pick = randomIndex(safe.length);
    if (!Number.isSafeInteger(pick) || pick < 0 || pick >= safe.length)
      throw new Error("Неверный источник случайных чисел.");
    const [tile] = safe.splice(pick, 1);
    tile.state = "warning";
    tile.fallsAt = now + FALLING_FLOOR_WARNING_MS;
  }
  match.wave++;
  match.nextWaveAt = null;
}

/** Earliest entry into a missing tile along the whole center path, including short corner crossings. */
function holeFraction(match: FallingFloorMatch, x: number, y: number, endX: number, endY: number) {
  if (isGone(match, x, y)) return 0;
  const cuts = [0, 1];
  for (const [start, end] of [
    [x, endX],
    [y, endY],
  ]) {
    if (start === end) continue;
    for (
      let line = Math.ceil(Math.min(start, end));
      line <= Math.floor(Math.max(start, end));
      line++
    ) {
      const fraction = (line - start) / (end - start);
      if (fraction > 0 && fraction < 1) cuts.push(fraction);
    }
  }
  cuts.sort((a, b) => a - b);
  for (let index = 1; index < cuts.length; index++) {
    const fraction = (cuts[index - 1] + cuts[index]) / 2;
    if (isGone(match, x + (endX - x) * fraction, y + (endY - y) * fraction)) return cuts[index - 1];
  }
  return isGone(match, endX, endY) ? 1 : null;
}
function moveStep(match: FallingFloorMatch, from: number, to: number) {
  const seconds = (to - from) / 1000;
  const decay = Math.exp(-FLOOR_BUMP_DRAG * seconds);
  const paths = match.players
    .filter((player) => player.alive)
    .map((player) => {
      const input = match.inputs[player.id];
      const active = input && from < input.at + FALLING_FLOOR_INPUT_TIMEOUT_MS;
      const vx = (active ? input.dx : 0) * FALLING_FLOOR_SPEED;
      const vy = (active ? input.dy : 0) * FALLING_FLOOR_SPEED;
      const bump = match.knockbacks[player.id] ?? { dx: 0, dy: 0 };
      const drift = (1 - decay) / FLOOR_BUMP_DRAG;
      const endX = clamp(player.x + vx * seconds + bump.dx * drift);
      const endY = clamp(player.y + vy * seconds + bump.dy * drift);
      const remaining = { dx: bump.dx * decay, dy: bump.dy * decay };
      match.knockbacks[player.id] = remaining;
      return {
        player,
        x: player.x,
        y: player.y,
        endX,
        endY,
        vx: vx + remaining.dx,
        vy: vy + remaining.dy,
        fall: holeFraction(match, player.x, player.y, endX, endY),
      };
    });
  resolveFloorCollisions(paths, match.knockbacks, clamp);
  for (const path of paths) path.fall = holeFraction(match, path.x, path.y, path.endX, path.endY);
  const falls = paths
    .flatMap((path) => (path.fall === null ? [] : [path.fall]))
    .sort((a, b) => a - b);
  let stop = 1;
  for (const fraction of falls) {
    if (paths.length - falls.filter((fall) => fall <= fraction + 1e-9).length <= 1) {
      stop = fraction;
      break;
    }
  }
  for (const path of paths) {
    const fallsNow = path.fall !== null && path.fall <= stop + 1e-9;
    const fraction = fallsNow ? path.fall! : stop;
    path.player.x = path.x + (path.endX - path.x) * fraction;
    path.player.y = path.y + (path.endY - path.y) * fraction;
    if (fallsNow) {
      path.player.alive = false;
      path.player.eliminatedAt = from + (to - from) * fraction;
      delete match.knockbacks[path.player.id];
    }
  }
  // A collapse exactly at the step boundary must resolve with movement falls at that instant.
  if (stop < 1 - 1e-9) finishIfDecided(match, from + (to - from) * stop);
}

export function advanceFallingFloor(
  match: FallingFloorMatch,
  now: number,
  randomIndex: (upper: number) => number,
) {
  if (!Number.isFinite(now)) return;
  if (match.phase === "countdown") {
    if (now < match.startsAt! && match.players.some((player) => !player.connected)) {
      match.phase = "lobby";
      match.startsAt = null;
      match.nextWaveAt = null;
      match.inputs = {};
      for (const player of match.players) player.ready = false;
      return;
    }
    if (now < match.startsAt!) return;
    match.phase = "running";
    match.simulatedAt = match.startsAt;
    match.nextWaveAt = match.startsAt! + FALLING_FLOOR_GRACE_MS;
  }
  if (match.phase !== "running" || now < match.simulatedAt!) return;
  while (match.phase === "running") {
    const from = match.simulatedAt!;
    waveEvents(match, from, randomIndex);
    if (match.phase === "running") eliminateOnGone(match, from);
    if (match.phase !== "running" || from >= now) break;
    let to = Math.min(now, from + STEP_MS, match.nextWaveAt ?? Infinity);
    for (const tile of match.tiles) if (tile.state === "warning") to = Math.min(to, tile.fallsAt!);
    for (const input of Object.values(match.inputs)) {
      const expiry = input.at + FALLING_FLOOR_INPUT_TIMEOUT_MS;
      if (expiry > from) to = Math.min(to, expiry);
    }
    moveStep(match, from, to);
    match.simulatedAt = match.endedAt ?? to;
  }
}

export function fallingFloorPresenceChanged(
  match: FallingFloorMatch,
  now: number,
  randomIndex: (upper: number) => number,
) {
  advanceFallingFloor(match, now, randomIndex);
  for (const player of match.players) if (!player.connected) delete match.inputs[player.id];
}
export function applyFallingFloorInput(
  match: FallingFloorMatch,
  playerId: string,
  input: FallingFloorInput,
  now: number,
  randomIndex: (upper: number) => number,
) {
  if (
    input.roundId !== match.roundId ||
    !Number.isSafeInteger(input.seq) ||
    input.seq < 0 ||
    !axis(input.dx) ||
    !axis(input.dy)
  )
    return false;
  advanceFallingFloor(match, now, randomIndex);
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (
    match.phase !== "running" ||
    !player?.connected ||
    !player.alive ||
    input.seq <= player.inputSeq ||
    now < match.simulatedAt!
  )
    return false;
  const length = Math.max(1, Math.hypot(input.dx, input.dy));
  match.inputs[playerId] = { dx: input.dx / length, dy: input.dy / length, at: now };
  player.inputSeq = input.seq;
  return true;
}
export function applyFallingFloorCommand(
  match: FallingFloorMatch,
  playerId: string,
  command: FallingFloorCommand,
  now: number,
  nextRoundId: string,
  randomIndex: (upper: number) => number,
) {
  advanceFallingFloor(match, now, randomIndex);
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player?.connected) throw new Error("Игрок должен быть на связи.");
  if (command.roundId !== match.roundId) throw new Error("Матч уже сменился.");
  if (
    (command.type !== "ready" || match.phase !== "lobby") &&
    (command.type !== "rematch" || match.phase !== "complete")
  )
    throw new Error("Действие сейчас недоступно.");
  if (
    match.players.length < FALLING_FLOOR_MIN_PLAYERS ||
    match.players.some((candidate) => !candidate.connected)
  )
    throw new Error("Дождись всех участников.");
  player.ready = true;
  if (!match.players.every((candidate) => candidate.ready)) return;
  const matchNumber = match.matchNumber + (command.type === "rematch" ? 1 : 0);
  const players = match.players;
  Object.assign(match, createFallingFloorMatch(nextRoundId), { players, matchNumber });
  for (const [index, participant] of players.entries()) {
    [participant.x, participant.y] = spawns[index];
    participant.ready = false;
    participant.alive = true;
    participant.eliminatedAt = null;
    participant.inputSeq = -1;
  }
  match.phase = "countdown";
  match.startsAt = now + FALLING_FLOOR_COUNTDOWN_MS;
  match.nextWaveAt = match.startsAt + FALLING_FLOOR_GRACE_MS;
}
export function fallingFloorPublicState(
  match: FallingFloorMatch,
): Omit<FallingFloorSnapshot, "id" | "code" | "revision" | "serverTime"> {
  return {
    phase: match.phase,
    roundId: match.roundId,
    players: match.players.map((player) => ({ ...player })),
    tiles: match.tiles.map((tile) => ({ ...tile })),
    startsAt: match.startsAt,
    nextWaveAt: match.nextWaveAt,
    wave: match.wave,
    winnerIds: [...match.winnerIds],
    endedAt: match.endedAt,
    matchNumber: match.matchNumber,
  };
}
