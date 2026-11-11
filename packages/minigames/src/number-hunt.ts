import type { MinigameCommand, MinigamePlayer, MinigameSnapshot } from "./session";

export const NUMBER_HUNT_REVEAL_MS = 900;
export const NUMBER_HUNT_MIN_PLAYERS = 2;
export const NUMBER_HUNT_MAX_PLAYERS = 2;
export interface NumberHuntSettings {
  numberCount: number;
}
export interface NumberHuntCard {
  index: number;
  number: number | null;
}
export interface NumberHuntCommand extends MinigameCommand {
  type: "ready" | "rematch" | "flip";
  index?: number;
  turn?: number;
}
export interface NumberHuntSnapshot extends MinigameSnapshot {
  settings: NumberHuntSettings;
  phase: "lobby" | "playing" | "revealing" | "complete";
  players: MinigamePlayer[];
  cards: NumberHuntCard[];
  nextNumber: number;
  turnPlayerId: string | null;
  turn: number;
  revealsAt: number | null;
  winnerIds: string[];
  matchNumber: number;
}
export interface NumberHuntMatch extends Omit<
  NumberHuntSnapshot,
  "id" | "code" | "revision" | "serverTime" | "cards"
> {
  deck: number[];
  opened: number[];
}

export function numberHuntSettings(input: Partial<NumberHuntSettings> = {}): NumberHuntSettings {
  const numberCount = input.numberCount ?? 10;
  if (!Number.isInteger(numberCount) || numberCount < 6 || numberCount > 20)
    throw new Error("В дуэли нужно 6–20 чисел.");
  return { numberCount };
}

export function numberHuntDeck(count: number, randomIndex: (upperBound: number) => number) {
  if (!Number.isInteger(count) || count < 6 || count > 20)
    throw new Error("Неверное количество чисел.");
  const deck = Array.from({ length: count }, (_, index) => index + 1);
  for (let index = deck.length - 1; index > 0; index--) {
    const other = randomIndex(index + 1);
    if (!Number.isInteger(other) || other < 0 || other > index)
      throw new Error("Неверный источник случайных чисел.");
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}

export function createNumberHuntMatch(
  roundId: string,
  input: Partial<NumberHuntSettings> = {},
  deck?: number[],
): NumberHuntMatch {
  const settings = numberHuntSettings(input);
  if (
    !deck ||
    deck.length !== settings.numberCount ||
    new Set(deck).size !== settings.numberCount ||
    deck.some((number) => !Number.isInteger(number) || number < 1 || number > settings.numberCount)
  )
    throw new Error("Нужна перемешанная колода чисел от 1 до размера поля.");
  return {
    settings,
    phase: "lobby",
    roundId,
    players: [],
    deck: [...deck],
    opened: [],
    nextNumber: 1,
    turnPlayerId: null,
    turn: 0,
    revealsAt: null,
    winnerIds: [],
    matchNumber: 1,
  };
}

export function addNumberHuntPlayer(match: NumberHuntMatch, id: string, name: string) {
  if (
    match.phase !== "lobby" ||
    match.players.length >= NUMBER_HUNT_MAX_PLAYERS ||
    match.players.some((p) => p.id === id)
  )
    throw new Error("В этом столе нет свободных мест.");
  match.players.push({
    id,
    name,
    score: 0,
    ready: false,
    connected: false,
  });
  for (const player of match.players) player.ready = false;
}

export function advanceNumberHunt(match: NumberHuntMatch, now: number) {
  if (match.phase !== "revealing" || now < match.revealsAt!) return;
  match.opened = [];
  match.nextNumber = 1;
  match.revealsAt = null;
  const index = match.players.findIndex((player) => player.id === match.turnPlayerId);
  match.turnPlayerId = match.players[(index + 1) % match.players.length].id;
  match.turn += 1;
  match.phase = "playing";
}

export function applyNumberHuntCommand(
  match: NumberHuntMatch,
  playerId: string,
  command: NumberHuntCommand,
  now: number,
  nextRoundId: string,
  newDeck: () => number[],
) {
  advanceNumberHunt(match, now);
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player || !player.connected) throw new Error("Игрок должен быть на связи.");
  if (command.roundId !== match.roundId) throw new Error("Партия уже сменилась. Обновляем стол.");
  if (command.type === "ready" || command.type === "rematch") {
    const rematch = command.type === "rematch";
    if (match.phase !== (rematch ? "complete" : "lobby"))
      throw new Error("Сейчас нельзя начать новую партию.");
    if (match.players.length < NUMBER_HUNT_MIN_PLAYERS || match.players.some((p) => !p.connected))
      throw new Error("Для старта нужны как минимум два игрока на связи.");
    player.ready = true;
    if (!match.players.every((p) => p.ready)) return;
    const fresh = createNumberHuntMatch(
      nextRoundId,
      match.settings,
      rematch ? newDeck() : match.deck,
    );
    Object.assign(match, fresh, {
      players: match.players,
      matchNumber: match.matchNumber + (rematch ? 1 : 0),
    });
    for (const candidate of match.players) candidate.ready = false;
    match.turnPlayerId = match.players[(match.matchNumber - 1) % match.players.length].id;
    match.phase = "playing";
    return;
  }
  if (command.type !== "flip") throw new Error("Неверная команда.");
  if (match.phase !== "playing") throw new Error("Дождись закрытия карточек.");
  if (match.turnPlayerId !== playerId) throw new Error("Сейчас ход другого игрока.");
  if (command.turn !== match.turn) throw new Error("Ход уже сменился. Обновляем поле.");
  const index = command.index;
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= match.deck.length ||
    match.opened.includes(index)
  )
    throw new Error("Выбери закрытую карточку.");
  match.opened.push(index);
  match.turn += 1;
  if (match.deck[index] !== match.nextNumber) {
    match.phase = "revealing";
    match.revealsAt = now + NUMBER_HUNT_REVEAL_MS;
    return;
  }
  match.nextNumber += 1;
  if (match.nextNumber <= match.settings.numberCount) return;
  match.winnerIds = [playerId];
  for (const candidate of match.players)
    if (match.winnerIds.includes(candidate.id)) candidate.score += 1;
  match.phase = "complete";
}

export function numberHuntPublicState(
  match: NumberHuntMatch,
): Omit<NumberHuntSnapshot, "id" | "code" | "revision" | "serverTime"> {
  return {
    settings: { ...match.settings },
    phase: match.phase,
    roundId: match.roundId,
    players: match.players.map((player) => ({ ...player })),
    cards: match.deck.map((number, index) => ({
      index,
      number: match.opened.includes(index) ? number : null,
    })),
    nextNumber: match.nextNumber,
    turnPlayerId: match.turnPlayerId,
    turn: match.turn,
    revealsAt: match.revealsAt,
    winnerIds: [...match.winnerIds],
    matchNumber: match.matchNumber,
  };
}
