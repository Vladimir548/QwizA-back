import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";

export const BLUFF_TOKENS = 15;
export const BLUFF_ROUNDS = 5;
export const BLUFF_BID_MS = 30000;
export const BLUFF_REVEAL_MS = 3200;
export interface BluffPlayer extends MinigamePlayer {
  tokens: number;
  points: number;
  submitted: boolean;
  bid: number | null;
}
export interface BluffAuction {
  auction: number;
  value: number;
  bids: { playerId: string; amount: number }[];
  winnerId: string | null;
}
export interface BluffSnapshot extends MinigameSnapshot {
  phase: "lobby" | "countdown" | "bidding" | "revealing" | "complete";
  players: BluffPlayer[];
  auction: number;
  trophies: number[];
  history: BluffAuction[];
  deadline: number | null;
  matchNumber: number;
  result: { winnerId: string | null } | null;
}
export interface BluffCommand extends MinigameCommand {
  type: "ready" | "bid" | "rematch";
  auction?: number;
  amount?: number;
}
export interface BluffMatch extends Omit<
  BluffSnapshot,
  "id" | "code" | "revision" | "serverTime" | "players"
> {
  players: Omit<BluffPlayer, "bid">[];
  bids: Record<string, number>;
}
function trophyOrder(randomIndex: (upper: number) => number) {
  const values = [2, 3, 4, 5, 6];
  for (let i = values.length - 1; i > 0; i--) {
    const other = randomIndex(i + 1);
    if (!Number.isInteger(other) || other < 0 || other > i)
      throw new Error("Неверный источник случайных чисел.");
    [values[i], values[other]] = [values[other], values[i]];
  }
  return values;
}
export function createBluffMatch(roundId: string): BluffMatch {
  return {
    phase: "lobby",
    roundId,
    players: [],
    auction: 0,
    trophies: [],
    history: [],
    bids: {},
    deadline: null,
    matchNumber: 1,
    result: null,
  };
}
export function addBluffPlayer(match: BluffMatch, id: string, name: string) {
  if (
    match.phase !== "lobby" ||
    match.players.length >= 2 ||
    match.players.some((p) => p.id === id)
  )
    throw new Error("Оба места уже заняты.");
  match.players.push({
    id,
    name,
    score: 0,
    ready: false,
    connected: false,
    tokens: BLUFF_TOKENS,
    points: 0,
    submitted: false,
  });
  for (const p of match.players) p.ready = false;
}
function reveal(match: BluffMatch, at: number) {
  for (const p of match.players) {
    match.bids[p.id] ??= 0;
    p.submitted = true;
    p.tokens -= match.bids[p.id];
  }
  const [a, b] = match.players,
    winner =
      match.bids[a.id] === match.bids[b.id] ? null : match.bids[a.id] > match.bids[b.id] ? a : b;
  if (winner) winner.points += match.trophies[match.auction - 1];
  match.history.push({
    auction: match.auction,
    value: match.trophies[match.auction - 1],
    bids: match.players.map((p) => ({ playerId: p.id, amount: match.bids[p.id] })),
    winnerId: winner?.id ?? null,
  });
  match.phase = "revealing";
  match.deadline = at + BLUFF_REVEAL_MS;
}
export function advanceBluff(match: BluffMatch, now: number) {
  if (!Number.isFinite(now)) return;
  while (match.deadline !== null && now >= match.deadline) {
    const at = match.deadline;
    if (match.phase === "countdown") {
      match.phase = "bidding";
      match.deadline = at + BLUFF_BID_MS;
    } else if (match.phase === "bidding") reveal(match, at);
    else if (match.phase === "revealing") {
      if (match.auction === BLUFF_ROUNDS) {
        const [a, b] = match.players;
        const winner = a.points === b.points ? null : a.points > b.points ? a : b;
        match.result = { winnerId: winner?.id ?? null };
        if (winner) winner.score++;
        match.phase = "complete";
        match.deadline = null;
        for (const p of match.players) p.ready = false;
      } else {
        match.auction++;
        match.phase = "bidding";
        match.bids = {};
        for (const p of match.players) p.submitted = false;
        match.deadline = at + BLUFF_BID_MS;
      }
    } else match.deadline = null;
  }
}
export function bluffPresenceChanged(match: BluffMatch) {
  if (match.phase === "countdown" && match.players.some((p) => !p.connected)) {
    match.phase = "lobby";
    match.deadline = null;
    for (const p of match.players) p.ready = false;
  }
}
export function applyBluffCommand(
  match: BluffMatch,
  id: string,
  command: BluffCommand,
  now: number,
  nextRoundId: string,
  randomIndex: (upper: number) => number,
) {
  advanceBluff(match, now);
  const player = match.players.find((p) => p.id === id);
  if (!player?.connected || command.roundId !== match.roundId)
    throw new Error("Партия сменилась или игрок не на связи.");
  if (command.type === "bid") {
    if (match.phase !== "bidding" || command.auction !== match.auction || player.submitted)
      throw new Error("Ставка уже принята или раунд завершён.");
    if (
      !Number.isSafeInteger(command.amount) ||
      command.amount! < 0 ||
      command.amount! > player.tokens
    )
      throw new Error("Выбери целое число жетонов из своего запаса.");
    match.bids[id] = command.amount!;
    player.submitted = true;
    // Do not deduct until both bids are revealed: the visible balance must not leak a bid.
    if (match.players.every((p) => p.submitted)) reveal(match, now);
    return;
  }
  if (
    (command.type !== "ready" || match.phase !== "lobby") &&
    (command.type !== "rematch" || match.phase !== "complete")
  )
    throw new Error("Действие сейчас недоступно.");
  if (match.players.length !== 2 || match.players.some((p) => !p.connected))
    throw new Error("Дождись соперника.");
  player.ready = true;
  if (!match.players.every((p) => p.ready)) return;
  const trophies = trophyOrder(randomIndex),
    players = match.players,
    matchNumber = match.matchNumber + Number(command.type === "rematch");
  Object.assign(match, createBluffMatch(nextRoundId), {
    players,
    trophies,
    matchNumber,
    auction: 1,
    phase: "countdown",
    deadline: now + 3000,
  });
  for (const p of players)
    Object.assign(p, { tokens: BLUFF_TOKENS, points: 0, submitted: false, ready: false });
}
export function bluffPublicState(
  match: BluffMatch,
  playerId?: string,
): Omit<BluffSnapshot, "id" | "code" | "revision" | "serverTime"> {
  const { bids, players, trophies, history, result, ...state } = match;
  const visible = match.phase === "revealing" || match.phase === "complete";
  return {
    ...state,
    trophies: [...trophies],
    history: history.map((h) => ({ ...h, bids: h.bids.map((b) => ({ ...b })) })),
    result: result ? { ...result } : null,
    players: players.map((p) => ({
      ...p,
      bid: p.id === playerId || visible ? (bids[p.id] ?? null) : null,
    })),
  };
}
