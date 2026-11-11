import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";

export const MEMORY_SYMBOLS = [
  "star",
  "bolt",
  "moon",
  "heart",
  "diamond",
  "flower",
  "sun",
  "leaf",
] as const;
export type MemorySymbol = (typeof MEMORY_SYMBOLS)[number];
export const MEMORY_REVEAL_MS = 1400;

export interface MemoryPlayer extends MinigamePlayer {
  pairs: number;
}
export interface MemoryCard {
  index: number;
  symbol: MemorySymbol | null;
  matchedBy: string | null;
}
export interface MemoryCommand extends MinigameCommand {
  type: "ready" | "flip" | "rematch";
  index?: number;
  turn?: number;
}
export interface MemorySnapshot extends MinigameSnapshot {
  phase: "lobby" | "playing" | "revealing" | "complete";
  players: MemoryPlayer[];
  cards: MemoryCard[];
  turnPlayerId: string | null;
  turn: number;
  revealsAt: number | null;
  winnerIds: string[];
  matchedPairs: number;
  matchNumber: number;
  lastPairBy: string | null;
}
export interface MemoryMatch {
  phase: MemorySnapshot["phase"];
  roundId: string;
  players: MemoryPlayer[];
  deck: MemorySymbol[];
  matchedBy: (string | null)[];
  opened: number[];
  turnPlayerId: string | null;
  turn: number;
  revealsAt: number | null;
  winnerIds: string[];
  matchNumber: number;
  lastPairBy: string | null;
}

export function memoryDeck(randomIndex: (upperBound: number) => number): MemorySymbol[] {
  const deck = [...MEMORY_SYMBOLS, ...MEMORY_SYMBOLS];
  for (let index = deck.length - 1; index > 0; index--) {
    const other = randomIndex(index + 1);
    if (!Number.isInteger(other) || other < 0 || other > index)
      throw new Error("Неверный источник случайных чисел.");
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}

export function createMemoryMatch(roundId: string, deck: MemorySymbol[]): MemoryMatch {
  if (
    deck.length !== 16 ||
    MEMORY_SYMBOLS.some((symbol) => deck.filter((value) => value === symbol).length !== 2)
  )
    throw new Error("На поле должно быть восемь разных пар.");
  return {
    phase: "lobby",
    roundId,
    players: [],
    deck: [...deck],
    matchedBy: deck.map(() => null),
    opened: [],
    turnPlayerId: null,
    turn: 0,
    revealsAt: null,
    winnerIds: [],
    matchNumber: 1,
    lastPairBy: null,
  };
}

export function addMemoryPlayer(match: MemoryMatch, id: string, name: string) {
  if (match.phase !== "lobby" || match.players.length >= 2)
    throw new Error("Оба места уже заняты.");
  match.players.push({ id, name, score: 0, ready: false, connected: false, pairs: 0 });
}

export function advanceMemory(match: MemoryMatch, now: number) {
  if (match.phase !== "revealing" || now < match.revealsAt!) return;
  match.opened = [];
  match.lastPairBy = null;
  match.revealsAt = null;
  const current = match.players.findIndex((player) => player.id === match.turnPlayerId);
  match.turnPlayerId = match.players[(current + 1) % match.players.length].id;
  match.turn += 1;
  match.phase = "playing";
}

export function applyMemoryCommand(
  match: MemoryMatch,
  playerId: string,
  command: MemoryCommand,
  now: number,
  nextRoundId: string,
  newDeck: () => MemorySymbol[],
) {
  advanceMemory(match, now);
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Место игрока не найдено.");
  if (command.roundId !== match.roundId) throw new Error("Партия уже сменилась. Обновляем стол.");
  if (command.type !== "flip") {
    const rematch = command.type === "rematch";
    if ((rematch && match.phase !== "complete") || (!rematch && match.phase !== "lobby"))
      throw new Error("Сейчас нельзя начать новую партию.");
    if (match.players.length !== 2 || match.players.some((candidate) => !candidate.connected))
      throw new Error("Для старта нужны два игрока на связи.");
    player.ready = true;
    if (!match.players.every((candidate) => candidate.ready)) return;
    if (rematch) {
      const fresh = createMemoryMatch(nextRoundId, newDeck());
      Object.assign(match, fresh, { players: match.players, matchNumber: match.matchNumber + 1 });
    } else match.roundId = nextRoundId;
    for (const candidate of match.players) {
      candidate.pairs = 0;
      candidate.ready = false;
    }
    match.winnerIds = [];
    match.turnPlayerId = match.players[(match.matchNumber - 1) % match.players.length].id;
    match.phase = "playing";
    return;
  }
  if (match.phase !== "playing") throw new Error("Дождись закрытия карт.");
  if (match.turnPlayerId !== playerId) throw new Error("Сейчас ход соперника.");
  if (command.turn !== match.turn) throw new Error("Ход уже сменился. Обновляем поле.");
  const index = command.index;
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= match.deck.length ||
    match.matchedBy[index] ||
    match.opened.includes(index)
  )
    throw new Error("Выбери закрытую карту.");
  match.opened.push(index);
  match.lastPairBy = null;
  if (match.opened.length < 2) return;
  const [first, second] = match.opened;
  if (match.deck[first] !== match.deck[second]) {
    match.phase = "revealing";
    match.revealsAt = now + MEMORY_REVEAL_MS;
    return;
  }
  match.matchedBy[first] = playerId;
  match.matchedBy[second] = playerId;
  match.opened = [];
  player.pairs += 1;
  match.lastPairBy = playerId;
  match.turn += 1;
  if (match.matchedBy.some((owner) => owner === null)) return;
  const best = Math.max(...match.players.map((candidate) => candidate.pairs));
  match.winnerIds = match.players
    .filter((candidate) => candidate.pairs === best)
    .map((candidate) => candidate.id);
  for (const candidate of match.players)
    if (match.winnerIds.includes(candidate.id)) candidate.score += 1;
  match.phase = "complete";
}

export function memoryPublicState(
  match: MemoryMatch,
): Omit<MemorySnapshot, "id" | "code" | "revision" | "serverTime"> {
  return {
    phase: match.phase,
    roundId: match.roundId,
    players: match.players.map((player) => ({ ...player })),
    cards: match.deck.map((symbol, index) => ({
      index,
      symbol:
        match.phase !== "lobby" && (match.matchedBy[index] || match.opened.includes(index))
          ? symbol
          : null,
      matchedBy: match.matchedBy[index],
    })),
    turnPlayerId: match.turnPlayerId,
    turn: match.turn,
    revealsAt: match.revealsAt,
    winnerIds: [...match.winnerIds],
    matchedPairs: match.matchedBy.filter(Boolean).length / 2,
    matchNumber: match.matchNumber,
    lastPairBy: match.lastPairBy,
  };
}
