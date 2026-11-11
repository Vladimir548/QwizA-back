import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";
import {
  HOCKEY,
  hockeyMallet,
  hockeyTarget,
  stepHockey,
  type HockeyBody,
  type HockeyMallet,
  type HockeyPoint,
} from "./hockey-physics";

export interface HockeyPlayer extends MinigamePlayer {
  goals: number;
}
export interface HockeyCommand extends MinigameCommand {
  type: "ready" | "rematch";
}
export interface HockeyInput extends HockeyPoint {
  roundId: string;
  sequence: number;
}
export interface HockeySnapshot extends MinigameSnapshot {
  phase: "lobby" | "countdown" | "playing" | "paused" | "complete";
  players: HockeyPlayer[];
  puck: HockeyBody;
  mallets: HockeyBody[];
  serveAt: number | null;
  serveReason: "start" | "goal" | "resume";
  lastScorerId: string | null;
  winnerId: string | null;
  matchNumber: number;
}
export interface HockeyMatch extends Omit<
  HockeySnapshot,
  "id" | "code" | "revision" | "serverTime" | "mallets"
> {
  mallets: HockeyMallet[];
  simulatedAt: number;
}
export function createHockeyMatch(roundId: string): HockeyMatch {
  return {
    phase: "lobby",
    roundId,
    players: [],
    puck: { x: 500, y: 280, vx: -380, vy: 115 },
    mallets: [hockeyMallet(0), hockeyMallet(1)],
    serveAt: null,
    serveReason: "start",
    lastScorerId: null,
    winnerId: null,
    matchNumber: 1,
    simulatedAt: 0,
  };
}
export function addHockeyPlayer(match: HockeyMatch, id: string, name: string) {
  if (match.phase !== "lobby" || match.players.length >= 2)
    throw new Error("Оба места уже заняты.");
  match.players.push({ id, name, score: 0, goals: 0, ready: false, connected: false });
}
function serve(match: HockeyMatch, now: number, direction: number) {
  const total = match.players.reduce((sum, p) => sum + p.goals, 0);
  match.puck = { x: 500, y: 280, vx: direction * 380, vy: total % 2 === 0 ? 115 : -115 };
  match.mallets = [hockeyMallet(0), hockeyMallet(1)];
  match.serveAt = now + (total === 0 ? 3000 : 1800);
  match.serveReason = total === 0 ? "start" : "goal";
  match.phase = "countdown";
  match.simulatedAt = now;
}
export function advanceHockey(match: HockeyMatch, now: number) {
  if (["lobby", "complete"].includes(match.phase)) return;
  if (match.players.some((p) => !p.connected)) {
    match.phase = "paused";
    match.serveAt = null;
    match.simulatedAt = now;
    for (const mallet of match.mallets) {
      mallet.target = { x: mallet.x, y: mallet.y };
      mallet.vx = 0;
      mallet.vy = 0;
    }
    return;
  }
  if (match.phase === "paused") {
    match.phase = "countdown";
    match.serveAt = now + 3000;
    match.serveReason = "resume";
    match.simulatedAt = now;
  }
  if (match.phase === "countdown") {
    if (now < match.serveAt!) return;
    match.simulatedAt = match.serveAt!;
    match.serveAt = null;
    match.phase = "playing";
  }
  // A stalled process must not teleport the puck through seconds of unseen play.
  match.simulatedAt = Math.max(match.simulatedAt, now - 250);
  while (match.simulatedAt + HOCKEY.stepMs <= now) {
    match.simulatedAt += HOCKEY.stepMs;
    const scorer = stepHockey(match.puck, match.mallets);
    if (scorer === null) continue;
    const player = match.players[scorer];
    player.goals += 1;
    match.lastScorerId = player.id;
    if (player.goals >= HOCKEY.winningGoals) {
      match.phase = "complete";
      match.winnerId = player.id;
      player.score += 1;
      for (const participant of match.players) participant.ready = false;
    } else serve(match, now, scorer === 0 ? 1 : -1);
    return;
  }
}
export function applyHockeyCommand(
  match: HockeyMatch,
  playerId: string,
  command: HockeyCommand,
  now: number,
  nextRoundId: string,
) {
  advanceHockey(match, now);
  const player = match.players.find((p) => p.id === playerId);
  if (!player || !player.connected) throw new Error("Игрок не подключён.");
  if (command.roundId !== match.roundId) throw new Error("Этот матч уже завершён.");
  if (
    (command.type === "ready" && match.phase !== "lobby") ||
    (command.type === "rematch" && match.phase !== "complete")
  )
    throw new Error("Действие сейчас недоступно.");
  if (match.players.length !== 2 || match.players.some((p) => !p.connected))
    throw new Error("Дождись соперника.");
  player.ready = true;
  if (!match.players.every((p) => p.ready)) return;
  if (command.type === "rematch") {
    match.roundId = nextRoundId;
    match.matchNumber += 1;
    match.lastScorerId = null;
    match.winnerId = null;
    for (const p of match.players) p.goals = 0;
  }
  for (const p of match.players) p.ready = false;
  serve(match, now, match.matchNumber % 2 === 1 ? -1 : 1);
}
export function applyHockeyInput(match: HockeyMatch, playerId: string, input: HockeyInput) {
  const side = match.players.findIndex((p) => p.id === playerId && p.connected);
  if (side < 0 || match.phase !== "playing" || input.roundId !== match.roundId) return;
  const mallet = match.mallets[side];
  if (
    !Number.isSafeInteger(input.sequence) ||
    input.sequence <= mallet.sequence ||
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y)
  )
    return;
  mallet.sequence = input.sequence;
  mallet.target = hockeyTarget(input, side);
}
export function hockeyPublicState(
  match: HockeyMatch,
): Omit<HockeySnapshot, "id" | "code" | "revision" | "serverTime"> {
  return {
    phase: match.phase,
    roundId: match.roundId,
    players: match.players.map((p) => ({ ...p })),
    puck: { ...match.puck },
    mallets: match.mallets.map(({ x, y, vx, vy }) => ({ x, y, vx, vy })),
    serveAt: match.serveAt,
    serveReason: match.serveReason,
    lastScorerId: match.lastScorerId,
    winnerId: match.winnerId,
    matchNumber: match.matchNumber,
  };
}
