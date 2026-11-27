import type { MinigameMode } from "./catalog";
import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";

export const ODD_EVEN_MAX_PLAYERS = 6;
export const ODD_EVEN_STARTING_CHIPS = 5;
export const ODD_EVEN_LAPS = 3;
export const ODD_EVEN_CHOICE_MS = 15_000;
const REVEAL_MS = 2_500;

export type OddEvenParity = "even" | "odd";
type Phase = "lobby" | "betting" | "guessing" | "revealing" | "complete";

export interface OddEvenTransfer {
  amount: number;
  guess: OddEvenParity;
  correct: boolean;
  paid: number;
  fromId: string;
  toId: string;
}

export interface OddEvenSnapshot extends MinigameSnapshot {
  mode: MinigameMode;
  phase: Phase;
  players: MinigamePlayer[];
  chips: number | null;
  bettorId: string | null;
  guesserId: string | null;
  lap: number;
  turn: number;
  deadline: number | null;
  transfer: OddEvenTransfer | null;
  winnerIds: string[];
  matchNumber: number;
}

export interface OddEvenCommand extends MinigameCommand {
  type: "ready" | "bet" | "guess" | "rematch";
  turn?: number;
  amount?: number;
  parity?: OddEvenParity;
}

type Player = MinigamePlayer & { chips: number };

export interface OddEvenMatch {
  roundId: string;
  mode: MinigameMode;
  phase: Phase;
  players: Player[];
  turn: number;
  bettor: Player | null;
  guesser: Player | null;
  stake: number | null;
  deadline: number | null;
  transfer: OddEvenTransfer | null;
  winnerIds: string[];
  matchNumber: number;
}

export function createOddEvenMatch(roundId: string, mode: MinigameMode = "group"): OddEvenMatch {
  return {
    roundId,
    mode,
    phase: "lobby",
    players: [],
    turn: 0,
    bettor: null,
    guesser: null,
    stake: null,
    deadline: null,
    transfer: null,
    winnerIds: [],
    matchNumber: 1,
  };
}

export function addOddEvenPlayer(match: OddEvenMatch, id: string, name: string) {
  const capacity = match.mode === "duel" ? 2 : ODD_EVEN_MAX_PLAYERS;
  if (match.phase !== "lobby" || match.players.length >= capacity)
    throw new Error("За столом нет свободных мест.");
  match.players.push({
    id,
    name,
    score: 0,
    ready: false,
    connected: false,
    chips: ODD_EVEN_STARTING_CHIPS,
  });
  for (const player of match.players) player.ready = false;
}

function nextTurn(match: OddEvenMatch, at: number) {
  const { players } = match;
  const count = players.length;
  const first = (match.matchNumber - 1) % count;
  const limit = count * ODD_EVEN_LAPS;
  match.stake = null;
  match.transfer = null;
  if (players.filter((player) => player.chips > 0).length > 1) {
    while (match.turn < limit) {
      const seat = (first + match.turn++) % count;
      if (!players[seat].chips) continue;
      match.bettor = players[seat];
      match.guesser = [...players.slice(seat + 1), ...players.slice(0, seat)].find(
        (p) => p.chips > 0,
      )!;
      match.phase = "betting";
      match.deadline = at + ODD_EVEN_CHOICE_MS;
      return;
    }
  }
  const best = Math.max(...players.map((player) => player.chips));
  match.winnerIds = players.filter((player) => player.chips === best).map((p) => p.id);
  for (const player of players) {
    if (player.chips === best) player.score++;
    player.ready = false;
  }
  match.phase = "complete";
  match.deadline = null;
  match.bettor = null;
  match.guesser = null;
}

function bet(match: OddEvenMatch, amount: number, at: number) {
  match.stake = amount;
  match.phase = "guessing";
  match.deadline = at + ODD_EVEN_CHOICE_MS;
}

function resolve(match: OddEvenMatch, guess: OddEvenParity, at: number) {
  const amount = match.stake!;
  const correct = guess === (amount % 2 === 0 ? "even" : "odd");
  const from = (correct ? match.bettor : match.guesser)!;
  const to = (correct ? match.guesser : match.bettor)!;
  const paid = Math.min(from.chips, amount);
  from.chips -= paid;
  to.chips += paid;
  match.transfer = { amount, guess, correct, paid, fromId: from.id, toId: to.id };
  match.stake = null;
  match.phase = "revealing";
  match.deadline = at + REVEAL_MS;
}

export function advanceOddEven(
  match: OddEvenMatch,
  now: number,
  randomIndex: (limit: number) => number,
) {
  while (match.deadline !== null && match.deadline <= now) {
    const at = match.deadline;
    if (match.phase === "betting") bet(match, 1, at);
    else if (match.phase === "guessing") resolve(match, randomIndex(2) === 0 ? "even" : "odd", at);
    else nextTurn(match, at);
  }
}

export function applyOddEvenCommand(
  match: OddEvenMatch,
  playerId: string,
  command: OddEvenCommand,
  now: number,
  nextRoundId: string,
  randomIndex: (limit: number) => number,
) {
  advanceOddEven(match, now, randomIndex);
  const player = match.players.find((p) => p.id === playerId);
  if (!player?.connected || command.roundId !== match.roundId)
    throw new Error("Раунд сменился или игрок не на связи.");
  if (command.type === "bet" || command.type === "guess") {
    if (command.turn !== match.turn) throw new Error("Ход уже сменился.");
    if (command.type === "bet" && match.phase === "betting" && match.bettor === player) {
      const amount = command.amount;
      if (
        amount === undefined ||
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        amount > player.chips
      )
        throw new Error("Выбери ставку от одной фишки до своего запаса.");
      bet(match, amount, now);
      return;
    }
    if (
      command.type === "guess" &&
      match.phase === "guessing" &&
      match.guesser === player &&
      (command.parity === "even" || command.parity === "odd")
    ) {
      resolve(match, command.parity, now);
      return;
    }
    throw new Error("Сейчас выбирает другой игрок.");
  }
  if (!(
    (command.type === "ready" && match.phase === "lobby") ||
    (command.type === "rematch" && match.phase === "complete")
  ))
    throw new Error("Действие сейчас недоступно.");
  if (match.players.length < 2 || !match.players.every((p) => p.connected))
    throw new Error("Дождись остальных игроков.");
  player.ready = true;
  if (!match.players.every((p) => p.ready)) return;
  if (command.type === "rematch") {
    match.roundId = nextRoundId;
    match.matchNumber++;
  }
  for (const p of match.players) {
    p.chips = ODD_EVEN_STARTING_CHIPS;
    p.ready = false;
  }
  match.winnerIds = [];
  match.turn = 0;
  nextTurn(match, now);
}

export function oddEvenPublicState(
  match: OddEvenMatch,
  viewer?: string,
): Omit<OddEvenSnapshot, "id" | "code" | "revision" | "serverTime"> {
  return {
    mode: match.mode,
    phase: match.phase,
    roundId: match.roundId,
    matchNumber: match.matchNumber,
    players: match.players.map(({ id, name, score, ready, connected }) => ({
      id,
      name,
      score,
      ready,
      connected,
    })),
    chips: match.players.find((p) => p.id === viewer)?.chips ?? null,
    bettorId: match.bettor?.id ?? null,
    guesserId: match.guesser?.id ?? null,
    lap: Math.max(1, Math.ceil(match.turn / Math.max(1, match.players.length))),
    turn: match.turn,
    deadline: match.deadline,
    transfer: match.transfer ? { ...match.transfer } : null,
    winnerIds: [...match.winnerIds],
  };
}
