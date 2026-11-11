import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";
import type { MinigameMode } from "./catalog";
import {
  PLAYER_BUMP_DRAG,
  resolvePlayerCollisions,
  type FloorVelocity,
} from "./falling-floor-collisions";

export const FIREFIGHT_CENTER = 4;
export const FIREFIGHT_ARENA_SCALE = 1.15;
export const FIREFIGHT_RADIUS = 3.2 * FIREFIGHT_ARENA_SCALE;
export const FIREFIGHT_BODY_RADIUS = 0.28;
export const FIREFIGHT_SPEED = 3.1;
export const FIREFIGHT_HP = 10;
export const FIREFIGHT_SHOT_MS = 500;
export const FIREFIGHT_BULLET_SPEED = 7;
export const FIREFIGHT_BULLET_RADIUS = 0.03;
export const FIREFIGHT_MAX_PLAYERS = 12;
export const FIREFIGHT_INPUT_TIMEOUT = 250;
const STEP_MS = 20;

export interface FirefightPlayer extends MinigamePlayer {
  x: number;
  y: number;
  alive: boolean;
  hp: number;
  eliminatedAt: number | null;
  inputSeq: number;
  aimX: number;
  aimY: number;
  lastShotAt: number | null;
  lastHitAt: number | null;
}
export interface FirefightBullet {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  bornAt: number;
}
export interface FirefightInput {
  roundId: string;
  seq: number;
  dx: number;
  dy: number;
  aimX: number;
  aimY: number;
  fire: boolean;
}
export interface FirefightCommand extends MinigameCommand {
  type: "ready" | "rematch";
}
export interface FirefightSnapshot extends MinigameSnapshot {
  phase: "lobby" | "countdown" | "running" | "complete";
  mode: MinigameMode;
  players: FirefightPlayer[];
  bullets: FirefightBullet[];
  startsAt: number | null;
  endedAt: number | null;
  matchNumber: number;
  winnerId: string | null;
}
export interface FirefightMatch extends Omit<
  FirefightSnapshot,
  "id" | "code" | "revision" | "serverTime"
> {
  simulatedAt: number | null;
  pausedCountdownMs: number;
  nextBullet: number;
  inputs: Record<string, FirefightInput & { at: number }>;
  bumps: Record<string, FloorVelocity>;
}
export function createFirefightMatch(
  roundId: string,
  mode: MinigameMode = "group",
): FirefightMatch {
  if (mode !== "duel" && mode !== "group") throw new Error("Неизвестный формат игры.");
  return {
    phase: "lobby",
    mode,
    roundId,
    players: [],
    bullets: [],
    startsAt: null,
    endedAt: null,
    matchNumber: 1,
    winnerId: null,
    simulatedAt: null,
    pausedCountdownMs: 3000,
    nextBullet: 0,
    inputs: {},
    bumps: {},
  };
}
export function addFirefightPlayer(match: FirefightMatch, id: string, name: string) {
  if (
    match.phase !== "lobby" ||
    match.players.length >= (match.mode === "duel" ? 2 : FIREFIGHT_MAX_PLAYERS) ||
    match.players.some((p) => p.id === id)
  )
    throw new Error("В этом бою больше нет свободных мест.");
  match.players.push({
    id,
    name,
    score: 0,
    ready: false,
    connected: false,
    x: 4,
    y: 4,
    alive: true,
    hp: FIREFIGHT_HP,
    eliminatedAt: null,
    inputSeq: -1,
    aimX: 1,
    aimY: 0,
    lastShotAt: null,
    lastHitAt: null,
  });
  for (const p of match.players) p.ready = false;
}
export function clampFirefightPosition(x: number, y: number) {
  const dx = x - FIREFIGHT_CENTER,
    dy = y - FIREFIGHT_CENTER;
  const factor = Math.min(
    1,
    (FIREFIGHT_RADIUS - FIREFIGHT_BODY_RADIUS) / Math.max(0.001, Math.hypot(dx, dy)),
  );
  return { x: FIREFIGHT_CENTER + dx * factor, y: FIREFIGHT_CENTER + dy * factor };
}
function shoot(match: FirefightMatch, p: FirefightPlayer, at: number) {
  const input = match.inputs[p.id];
  if (
    !p.alive ||
    !p.connected ||
    !input?.fire ||
    at >= input.at + FIREFIGHT_INPUT_TIMEOUT ||
    (p.lastShotAt !== null && at < p.lastShotAt + FIREFIGHT_SHOT_MS)
  )
    return;
  p.lastShotAt = at;
  match.bullets.push({
    id: ++match.nextBullet,
    ownerId: p.id,
    x: p.x + p.aimX * 0.36,
    y: p.y + p.aimY * 0.36,
    dx: p.aimX,
    dy: p.aimY,
    bornAt: at,
  });
}
/** Earliest contact along a swept bullet relative to a moving target. */
function contact(x: number, y: number, dx: number, dy: number) {
  const radius = FIREFIGHT_BODY_RADIUS + FIREFIGHT_BULLET_RADIUS;
  const c = x * x + y * y - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy,
    b = 2 * (x * dx + y * dy),
    d = b * b - 4 * a * c;
  if (a < 1e-12 || d < 0) return null;
  const t = (-b - Math.sqrt(d)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
function step(match: FirefightMatch, from: number, to: number) {
  const dt = (to - from) / 1000,
    decay = Math.exp(-PLAYER_BUMP_DRAG * dt);
  for (const p of match.players) shoot(match, p, from);
  const paths = match.players
    .filter((p) => p.alive)
    .map((player) => {
      const control = match.inputs[player.id],
        input =
          control && player.connected && from < control.at + FIREFIGHT_INPUT_TIMEOUT
            ? control
            : { dx: 0, dy: 0 };
      const bump = match.bumps[player.id] ?? { dx: 0, dy: 0 },
        vx = input.dx * FIREFIGHT_SPEED,
        vy = input.dy * FIREFIGHT_SPEED;
      match.bumps[player.id] = { dx: bump.dx * decay, dy: bump.dy * decay };
      const end = clampFirefightPosition(
        player.x + vx * dt + (bump.dx * (1 - decay)) / PLAYER_BUMP_DRAG,
        player.y + vy * dt + (bump.dy * (1 - decay)) / PLAYER_BUMP_DRAG,
      );
      return {
        player,
        x: player.x,
        y: player.y,
        endX: end.x,
        endY: end.y,
        vx: vx + bump.dx * decay,
        vy: vy + bump.dy * decay,
        fall: null,
      };
    });
  resolvePlayerCollisions(paths, match.bumps, (v) => v);
  for (const path of paths) {
    const end = clampFirefightPosition(path.endX, path.endY);
    path.endX = end.x;
    path.endY = end.y;
    path.player.x = end.x;
    path.player.y = end.y;
  }
  // Resolve against the same living set, allowing simultaneous lethal trades.
  const damage = new Map<string, number>();
  match.bullets = match.bullets.filter((bullet) => {
    const dx = bullet.dx * FIREFIGHT_BULLET_SPEED * dt,
      dy = bullet.dy * FIREFIGHT_BULLET_SPEED * dt;
    let hit: FirefightPlayer | null = null,
      first = Infinity;
    for (const path of paths) {
      if (path.player.id === bullet.ownerId) continue;
      const t = contact(
        bullet.x - path.x,
        bullet.y - path.y,
        dx - (path.endX - path.x),
        dy - (path.endY - path.y),
      );
      if (t !== null && t < first) {
        first = t;
        hit = path.player;
      }
    }
    if (hit) {
      damage.set(hit.id, (damage.get(hit.id) ?? 0) + 1);
      return false;
    }
    bullet.x += dx;
    bullet.y += dy;
    return (
      Math.hypot(bullet.x - 4, bullet.y - 4) <= FIREFIGHT_RADIUS + 0.5 && to - bullet.bornAt < 2000
    );
  });
  for (const p of match.players) {
    if (!damage.has(p.id)) continue;
    p.hp = Math.max(0, p.hp - damage.get(p.id)!);
    p.lastHitAt = to;
    if (p.hp === 0) {
      p.alive = false;
      p.eliminatedAt = to;
      delete match.inputs[p.id];
    }
  }
  const alive = match.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    match.phase = "complete";
    match.endedAt = to;
    match.winnerId = alive[0]?.id ?? null;
    if (alive[0]) alive[0].score++;
    match.inputs = {};
    match.bumps = {};
    match.bullets = [];
  }
}
export function advanceFirefight(match: FirefightMatch, now: number) {
  if (!Number.isFinite(now)) return;
  if (
    match.phase === "countdown" &&
    match.startsAt !== null &&
    now >= match.startsAt &&
    match.players.every((p) => p.connected)
  ) {
    match.phase = "running";
    match.simulatedAt = match.startsAt;
  }
  while (match.phase === "running" && now > match.simulatedAt!) {
    const from = match.simulatedAt!;
    let to = Math.min(now, from + STEP_MS);
    for (const p of match.players) {
      const control = match.inputs[p.id];
      for (const deadline of [
        control ? control.at + FIREFIGHT_INPUT_TIMEOUT : 0,
        control?.fire && p.lastShotAt !== null ? p.lastShotAt + FIREFIGHT_SHOT_MS : 0,
      ])
        if (deadline > from) to = Math.min(to, deadline);
    }
    step(match, from, to);
    match.simulatedAt = to;
  }
}
export function applyFirefightInput(
  match: FirefightMatch,
  id: string,
  input: FirefightInput,
  now: number,
) {
  if (
    input.roundId !== match.roundId ||
    !Number.isSafeInteger(input.seq) ||
    input.seq < 0 ||
    typeof input.fire !== "boolean" ||
    [input.dx, input.dy, input.aimX, input.aimY].some(
      (v) => !Number.isFinite(v) || Math.abs(v) > 1,
    ) ||
    Math.hypot(input.aimX, input.aimY) < 0.01
  )
    return false;
  advanceFirefight(match, now);
  const player = match.players.find((p) => p.id === id);
  if (
    match.phase !== "running" ||
    !player?.alive ||
    !player.connected ||
    input.seq <= player.inputSeq ||
    now < match.simulatedAt!
  )
    return false;
  const length = Math.max(1, Math.hypot(input.dx, input.dy)),
    aim = Math.hypot(input.aimX, input.aimY);
  player.inputSeq = input.seq;
  player.aimX = input.aimX / aim;
  player.aimY = input.aimY / aim;
  match.inputs[id] = { ...input, dx: input.dx / length, dy: input.dy / length, at: now };
  shoot(match, player, now);
  return true;
}
export function firefightPresenceChanged(match: FirefightMatch, now: number) {
  for (const p of match.players) if (!p.connected) delete match.inputs[p.id];
  advanceFirefight(match, now);
  if (match.phase !== "countdown") return;
  if (match.players.some((p) => !p.connected) && match.startsAt !== null) {
    match.pausedCountdownMs = Math.max(1000, match.startsAt - now);
    match.startsAt = null;
  } else if (match.players.every((p) => p.connected) && match.startsAt === null)
    match.startsAt = now + match.pausedCountdownMs;
}
export function applyFirefightCommand(
  match: FirefightMatch,
  id: string,
  command: FirefightCommand,
  now: number,
  nextRoundId: string,
) {
  advanceFirefight(match, now);
  const player = match.players.find((p) => p.id === id);
  if (!player?.connected || command.roundId !== match.roundId)
    throw new Error("Раунд сменился или игрок не на связи.");
  if (
    (command.type !== "ready" || match.phase !== "lobby") &&
    (command.type !== "rematch" || match.phase !== "complete")
  )
    throw new Error("Действие сейчас недоступно.");
  if (match.players.length < 2 || match.players.some((p) => !p.connected))
    throw new Error("Дождись остальных игроков.");
  player.ready = true;
  if (!match.players.every((p) => p.ready)) return;
  const players = match.players,
    matchNumber = match.matchNumber + Number(command.type === "rematch");
  Object.assign(match, createFirefightMatch(nextRoundId, match.mode), {
    players,
    matchNumber,
    phase: "countdown",
    startsAt: now + 3000,
  });
  players.forEach((p, i) => {
    const angle = Math.PI + (i * Math.PI * 2) / players.length;
    Object.assign(p, {
      x: 4 + Math.cos(angle) * 2.25,
      y: 4 + Math.sin(angle) * 2.25,
      aimX: -Math.cos(angle),
      aimY: -Math.sin(angle),
      hp: FIREFIGHT_HP,
      alive: true,
      eliminatedAt: null,
      ready: false,
      inputSeq: -1,
      lastShotAt: null,
      lastHitAt: null,
    });
  });
}
export function firefightPublicState(
  match: FirefightMatch,
): Omit<FirefightSnapshot, "id" | "code" | "revision" | "serverTime"> {
  return {
    phase: match.phase,
    mode: match.mode,
    roundId: match.roundId,
    players: match.players.map((p) => ({ ...p })),
    bullets: match.bullets.map((b) => ({ ...b })),
    startsAt: match.startsAt,
    endedAt: match.endedAt,
    matchNumber: match.matchNumber,
    winnerId: match.winnerId,
  };
}
