import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";

export const TWENTY_ONE_FLIGHT_MS = 620;
export const TWENTY_ONE_FLIP_MS = 300;
export const TWENTY_ONE_REVEAL_MS = 1000;
export const TWENTY_ONE_SUITS = ["spades", "hearts", "clubs", "diamonds"] as const;
export const TWENTY_ONE_RANKS = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export interface TwentyOneFace {
  rank: (typeof TWENTY_ONE_RANKS)[number];
  suit: (typeof TWENTY_ONE_SUITS)[number];
}
export interface TwentyOneCard {
  id: string;
  order: number;
  dealtAt: number;
  arrivesAt: number;
  face: TwentyOneFace | null;
}
export type TwentyOneState = "choosing" | "stood" | "bust" | "twenty-one";
export interface TwentyOnePlayer extends MinigamePlayer {
  cards: TwentyOneCard[];
  total: number | null;
  state: TwentyOneState | "done";
  handVersion: number;
  busyUntil: number | null;
}
export interface TwentyOneResult {
  winnerId: string | null;
  reason: "closer" | "bust" | "tie" | "both-bust";
}
export interface TwentyOneSnapshot extends MinigameSnapshot {
  phase: "lobby" | "dealing" | "playing" | "revealing" | "complete";
  players: TwentyOnePlayer[];
  matchNumber: number;
  dealtCount: number;
  resolvesAt: number | null;
  result: TwentyOneResult | null;
}
export interface TwentyOneCommand extends MinigameCommand {
  type: "ready" | "hit" | "stand" | "rematch";
  handVersion?: number;
}
interface PrivatePlayer extends MinigamePlayer {
  cards: (TwentyOneCard & { face: TwentyOneFace })[];
  state: TwentyOneState;
  handVersion: number;
  busyUntil: number | null;
}
export interface TwentyOneMatch {
  phase: TwentyOneSnapshot["phase"];
  roundId: string;
  players: PrivatePlayer[];
  deck: TwentyOneFace[];
  matchNumber: number;
  dealtCount: number;
  resolvesAt: number | null;
  result: TwentyOneResult | null;
}

export function twentyOneValue(face: TwentyOneFace) {
  return face.rank === "A"
    ? 11
    : face.rank === "K"
      ? 4
      : face.rank === "Q"
        ? 3
        : face.rank === "J"
          ? 2
          : Number(face.rank);
}
export const twentyOneTotal = (faces: TwentyOneFace[]) =>
  faces.reduce((sum, face) => sum + twentyOneValue(face), 0);
export function twentyOneDeck(randomIndex: (upper: number) => number): TwentyOneFace[] {
  const deck = TWENTY_ONE_SUITS.flatMap((suit) => TWENTY_ONE_RANKS.map((rank) => ({ rank, suit })));
  for (let index = deck.length - 1; index > 0; index--) {
    const other = randomIndex(index + 1);
    if (!Number.isInteger(other) || other < 0 || other > index)
      throw new Error("Неверный источник случайных чисел.");
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}
function validDeck(deck: TwentyOneFace[]) {
  return (
    deck.length === 36 &&
    new Set(deck.map((c) => `${c.rank}:${c.suit}`)).size === 36 &&
    deck.every((c) => TWENTY_ONE_RANKS.includes(c.rank) && TWENTY_ONE_SUITS.includes(c.suit))
  );
}
export function createTwentyOneMatch(roundId: string, deck: TwentyOneFace[]): TwentyOneMatch {
  if (!validDeck(deck)) throw new Error("Нужна колода из 36 разных карт.");
  return {
    phase: "lobby",
    roundId,
    players: [],
    deck: deck.map((c) => ({ ...c })),
    matchNumber: 1,
    dealtCount: 0,
    resolvesAt: null,
    result: null,
  };
}
export function addTwentyOnePlayer(match: TwentyOneMatch, id: string, name: string) {
  if (match.phase !== "lobby" || match.players.length >= 2)
    throw new Error("Оба места уже заняты.");
  match.players.push({
    id,
    name,
    score: 0,
    ready: false,
    connected: false,
    cards: [],
    state: "choosing",
    handVersion: 0,
    busyUntil: null,
  });
}
function draw(match: TwentyOneMatch, player: PrivatePlayer, at: number) {
  const face = match.deck[match.dealtCount];
  if (!face) throw new Error("В колоде не осталось карт.");
  const order = match.dealtCount++;
  const arrivesAt = at + TWENTY_ONE_FLIGHT_MS;
  player.cards.push({
    id: `${match.roundId}:${order}`,
    order,
    dealtAt: at,
    arrivesAt,
    face: { ...face },
  });
  player.busyUntil = arrivesAt + TWENTY_ONE_FLIP_MS;
}
function resolve(match: TwentyOneMatch): TwentyOneResult {
  const totals = match.players.map((p) => twentyOneTotal(p.cards.map((c) => c.face)));
  if (totals.every((total) => total > 21)) return { winnerId: null, reason: "both-bust" };
  if (totals[0] === totals[1]) return { winnerId: null, reason: "tie" };
  const winner = totals[0] > 21 ? 1 : totals[1] > 21 ? 0 : totals[0] > totals[1] ? 0 : 1;
  return {
    winnerId: match.players[winner].id,
    reason: totals.some((t) => t > 21) ? "bust" : "closer",
  };
}
export function advanceTwentyOne(match: TwentyOneMatch, now: number) {
  if (match.phase === "dealing" || match.phase === "playing") {
    for (const player of match.players) {
      if (player.busyUntil === null || now < player.busyUntil) continue;
      player.busyUntil = null;
      const total = twentyOneTotal(player.cards.map((c) => c.face));
      if (total >= 21) player.state = total === 21 ? "twenty-one" : "bust";
    }
    if (match.phase === "dealing" && match.players.every((p) => p.busyUntil === null))
      match.phase = "playing";
    if (
      match.phase === "playing" &&
      match.players.every((p) => p.state !== "choosing" && p.busyUntil === null)
    ) {
      match.phase = "revealing";
      match.resolvesAt = now + TWENTY_ONE_REVEAL_MS;
    }
  }
  if (match.phase === "revealing" && now >= match.resolvesAt!) {
    match.result = resolve(match);
    if (match.result.winnerId)
      match.players.find((p) => p.id === match.result!.winnerId)!.score += 1;
    match.phase = "complete";
    match.resolvesAt = null;
    for (const p of match.players) p.ready = false;
  }
}
export function applyTwentyOneCommand(
  match: TwentyOneMatch,
  playerId: string,
  command: TwentyOneCommand,
  now: number,
  nextRoundId: string,
  newDeck: () => TwentyOneFace[],
) {
  advanceTwentyOne(match, now);
  const player = match.players.find((p) => p.id === playerId);
  if (!player || !player.connected) throw new Error("Игрок не подключён.");
  if (command.roundId !== match.roundId) throw new Error("Партия уже сменилась.");
  if (command.type === "hit" || command.type === "stand") {
    if (match.phase !== "playing" || player.state !== "choosing" || player.busyUntil !== null)
      throw new Error("Дождись окончания раздачи или новой партии.");
    if (command.handVersion !== player.handVersion) throw new Error("Рука уже изменилась.");
    if (command.type === "hit") draw(match, player, now + 50);
    else player.state = "stood";
    player.handVersion += 1;
    advanceTwentyOne(match, now);
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
  if (command.type === "rematch") {
    const deck = newDeck();
    if (!validDeck(deck)) throw new Error("Нужна колода из 36 разных карт.");
    match.deck = deck.map((c) => ({ ...c }));
    match.matchNumber += 1;
  }
  match.roundId = nextRoundId;
  match.phase = "dealing";
  match.result = null;
  match.resolvesAt = null;
  match.dealtCount = 0;
  for (const p of match.players) {
    p.cards = [];
    p.state = "choosing";
    p.busyUntil = null;
    p.ready = false;
    p.handVersion = 1;
  }
  for (let index = 0; index < 4; index++)
    draw(match, match.players[index % 2], now + 300 + index * 180);
}
export function twentyOnePublicState(
  match: TwentyOneMatch,
  playerId: string | undefined,
  now: number,
): Omit<TwentyOneSnapshot, "id" | "code" | "revision" | "serverTime"> {
  const revealed = match.phase === "revealing" || match.phase === "complete";
  return {
    phase: match.phase,
    roundId: match.roundId,
    matchNumber: match.matchNumber,
    dealtCount: match.dealtCount,
    resolvesAt: match.resolvesAt,
    result: match.result ? { ...match.result } : null,
    players: match.players.map(({ cards, state, ...p }) => {
      const visible = p.id === playerId || revealed;
      const total =
        visible && (p.id === playerId || match.phase === "complete")
          ? twentyOneTotal(cards.filter((c) => c.arrivesAt <= now).map((c) => c.face))
          : null;
      return {
        ...p,
        total,
        state: visible ? state : state === "choosing" ? "choosing" : "done",
        cards: cards.map((c) => ({
          ...c,
          face: visible && c.arrivesAt <= now ? { ...c.face } : null,
        })),
      };
    }),
  };
}
