import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";
import type { MinigameMode } from "./catalog";

export const SHELL_MAX_PLAYERS = 12;
export const SHELL_SHOW_MS = 2200;
export const SHELL_HIDE_MS = 450;
export const SHELL_CHOOSE_MS = 10000;
export const SHELL_REVEAL_MS = 2600;
export const shellSwapDuration = (round: number) =>
  Math.round(Math.max(180, 720 * 0.86 ** (round - 1)) / (1.3 * 1.1));
export const shellSwapCount = (round: number) => 6 + Math.min(12, round - 1);

export function shellPlaces(points: number[]) {
  const levels = [...new Set(points)].sort((a, b) => b - a);
  return new Map(levels.map((score, index) => [score, index + 1]));
}

export interface ShellPlayer extends MinigamePlayer {
  alive: boolean;
  points: number;
  choice: number | null;
  chosen: boolean;
  correct: boolean | null;
}
export interface ShellSwap {
  from: number;
  to: number;
  startedAt: number;
  endsAt: number;
}
export interface ShellCommand extends MinigameCommand {
  type: "ready" | "rematch" | "choose";
  slot?: number;
}
export interface ShellSnapshot extends MinigameSnapshot {
  phase: "lobby" | "showing" | "hiding" | "shuffling" | "choosing" | "revealing" | "complete";
  mode: MinigameMode;
  players: ShellPlayer[];
  round: number;
  order: number[];
  swap: ShellSwap | null;
  swapsDone: number;
  swapCount: number;
  swapDuration: number;
  coinSlot: number | null;
  deadline: number | null;
  allMissed: boolean;
  winnerId: string | null;
  matchNumber: number;
}
export interface ShellMatch extends Omit<
  ShellSnapshot,
  "id" | "code" | "revision" | "serverTime" | "coinSlot"
> {
  coinCup: number;
  lastPair: number;
}
type RandomIndex = (upper: number) => number;
function pick(random: RandomIndex, upper: number) {
  const value = random(upper);
  if (!Number.isInteger(value) || value < 0 || value >= upper)
    throw new Error("Неверный источник случайных чисел.");
  return value;
}
export function createShellMatch(roundId: string, mode: MinigameMode = "group"): ShellMatch {
  if (mode !== "duel" && mode !== "group") throw new Error("Неизвестный формат игры.");
  return {
    phase: "lobby",
    mode,
    roundId,
    players: [],
    round: 0,
    order: [0, 1, 2],
    coinCup: 0,
    swap: null,
    lastPair: -1,
    swapsDone: 0,
    swapCount: 6,
    swapDuration: shellSwapDuration(1),
    deadline: null,
    allMissed: false,
    winnerId: null,
    matchNumber: 1,
  };
}
export function addShellPlayer(match: ShellMatch, id: string, name: string) {
  if (
    match.phase !== "lobby" ||
    match.players.length >= (match.mode === "duel" ? 2 : SHELL_MAX_PLAYERS) ||
    match.players.some((p) => p.id === id)
  )
    throw new Error("За столом нет свободных мест.");
  match.players.push({
    id,
    name,
    score: 0,
    ready: false,
    connected: false,
    alive: true,
    points: 0,
    choice: null,
    chosen: false,
    correct: null,
  });
  for (const p of match.players) p.ready = false;
}
function startRound(match: ShellMatch, at: number, random: RandomIndex, nextId: string) {
  const firstRound = match.round === 0;
  if (firstRound) match.coinCup = pick(random, 3);
  match.round++;
  match.roundId = nextId;
  match.swap = null;
  match.lastPair = -1;
  match.swapsDone = 0;
  match.swapCount = shellSwapCount(match.round);
  match.swapDuration = shellSwapDuration(match.round);
  match.phase = firstRound ? "showing" : "hiding";
  match.deadline = at + (firstRound ? SHELL_SHOW_MS : SHELL_HIDE_MS);
  for (const p of match.players)
    if (p.alive) {
      p.choice = null;
      p.chosen = false;
      p.correct = null;
    }
}
function startSwap(match: ShellMatch, at: number, random: RandomIndex) {
  const pairs = [
      [0, 1],
      [1, 2],
      [0, 2],
    ],
    available = pairs.map((_, i) => i).filter((i) => i !== match.lastPair);
  match.lastPair = available[pick(random, available.length)];
  const [from, to] = pairs[match.lastPair];
  match.swap = { from, to, startedAt: at, endsAt: at + match.swapDuration };
  match.deadline = match.swap.endsAt;
}
function reveal(match: ShellMatch, at: number) {
  const coinSlot = match.order.indexOf(match.coinCup),
    active = match.players.filter((p) => p.alive);
  for (const p of active) p.correct = p.choice === coinSlot;
  match.allMissed = active.every((p) => !p.correct);
  if (!match.allMissed)
    for (const p of active) {
      p.alive = p.correct === true;
      if (p.alive) p.points++;
    }
  match.phase = "revealing";
  match.deadline = at + SHELL_REVEAL_MS;
  match.swap = null;
}
export function advanceShell(
  match: ShellMatch,
  now: number,
  random: RandomIndex,
  nextId: () => string,
) {
  if (!Number.isFinite(now)) return;
  while (match.deadline !== null && now >= match.deadline) {
    const at = match.deadline;
    if (match.phase === "showing") {
      match.phase = "hiding";
      match.deadline = at + SHELL_HIDE_MS;
    } else if (match.phase === "hiding") {
      match.phase = "shuffling";
      startSwap(match, at, random);
    } else if (match.phase === "shuffling" && match.swap) {
      const { from, to } = match.swap;
      [match.order[from], match.order[to]] = [match.order[to], match.order[from]];
      match.swapsDone++;
      if (match.swapsDone === match.swapCount) {
        match.swap = null;
        match.phase = "choosing";
        match.deadline = at + SHELL_CHOOSE_MS;
      } else startSwap(match, at, random);
    } else if (match.phase === "choosing") reveal(match, at);
    else if (match.phase === "revealing") {
      const survivors = match.players.filter((p) => p.alive);
      if (match.allMissed || survivors.length === 1) {
        match.phase = "complete";
        match.deadline = null;
        if (survivors.length === 1) {
          match.winnerId = survivors[0].id;
          survivors[0].score++;
        }
        for (const p of match.players) p.ready = false;
      } else startRound(match, at, random, nextId());
    } else break;
  }
}
export function applyShellCommand(
  match: ShellMatch,
  id: string,
  command: ShellCommand,
  now: number,
  nextRoundId: string,
  random: RandomIndex,
  nextId: () => string,
) {
  advanceShell(match, now, random, nextId);
  const self = match.players.find((p) => p.id === id);
  if (!self?.connected || command.roundId !== match.roundId)
    throw new Error("Раунд сменился или игрок не на связи.");
  if (command.type === "choose") {
    if (match.phase !== "choosing" || !self.alive || self.chosen)
      throw new Error("Выбор сейчас недоступен.");
    if (!Number.isInteger(command.slot) || command.slot! < 0 || command.slot! > 2)
      throw new Error("Выбери один из трёх стаканов.");
    self.choice = command.slot!;
    self.chosen = true;
    if (match.players.every((p) => !p.alive || p.chosen)) reveal(match, now);
    return;
  }
  if (
    (command.type !== "ready" || match.phase !== "lobby") &&
    (command.type !== "rematch" || match.phase !== "complete")
  )
    throw new Error("Действие сейчас недоступно.");
  if (match.players.length < 2 || match.players.some((p) => !p.connected))
    throw new Error("Дождись всех участников.");
  self.ready = true;
  if (!match.players.every((p) => p.ready)) return;
  const players = match.players,
    matchNumber = match.matchNumber + Number(command.type === "rematch");
  Object.assign(match, createShellMatch(nextRoundId, match.mode), { players, matchNumber });
  for (const p of players)
    Object.assign(p, {
      alive: true,
      points: 0,
      ready: false,
      choice: null,
      chosen: false,
      correct: null,
    });
  startRound(match, now, random, nextRoundId);
}
export function shellPublicState(
  match: ShellMatch,
  playerId?: string,
): Omit<ShellSnapshot, "id" | "code" | "revision" | "serverTime"> {
  const revealed = match.phase === "revealing" || match.phase === "complete";
  return {
    phase: match.phase,
    mode: match.mode,
    roundId: match.roundId,
    players: match.players.map((p) => ({
      ...p,
      choice: revealed || p.id === playerId ? p.choice : null,
    })),
    round: match.round,
    order: [...match.order],
    swap: match.swap ? { ...match.swap } : null,
    swapsDone: match.swapsDone,
    swapCount: match.swapCount,
    swapDuration: match.swapDuration,
    coinSlot:
      revealed || match.phase === "showing" || match.phase === "hiding"
        ? match.order.indexOf(match.coinCup)
        : null,
    deadline: match.deadline,
    allMissed: match.allMissed,
    winnerId: match.winnerId,
    matchNumber: match.matchNumber,
  };
}
