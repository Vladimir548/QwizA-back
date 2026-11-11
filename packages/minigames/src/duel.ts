import { MINIGAMES, minigameSupportsMode, type MinigamesForMode } from "./catalog";
import type { MinigameKind } from "./session";

export type DuelMinigameKind = MinigamesForMode<"duel">;
export const duelMinigames = () =>
  (Object.keys(MINIGAMES) as MinigameKind[]).filter((kind): kind is DuelMinigameKind =>
    minigameSupportsMode(kind, "duel"),
  );
export interface DuelPlayer {
  id: string;
  name: string;
  score: number;
  accountId?: string | null;
}
export interface DuelEvent {
  id: string;
  challengerId: string;
  opponentId: string;
  kind: DuelMinigameKind;
  stake: number;
  phase: "pending" | "playing" | "result";
  winnerId?: string | null;
}
export function duelBalance(players: DuelPlayer[], id: string): number {
  const player = players.find((p) => p.id === id);
  if (!player) return 0;
  return player.accountId
    ? players.filter((p) => p.accountId === player.accountId).reduce((sum, p) => sum + p.score, 0)
    : player.score;
}
export function maxDuelStake(players: DuelPlayer[], first: string, second: string): number {
  return Math.max(
    0,
    Math.floor(Math.min(duelBalance(players, first), duelBalance(players, second)) * 0.3),
  );
}
export function validateDuel(
  players: DuelPlayer[],
  challengerId: string,
  opponentId: string,
  kind: string,
  stake: number,
): asserts kind is DuelMinigameKind {
  const a = players.find((p) => p.id === challengerId);
  const b = players.find((p) => p.id === opponentId);
  if (!a || !b || a.id === b.id || (a.accountId && a.accountId === b.accountId))
    throw new Error("Выбери соперника из другой команды или другого игрока");
  if (!duelMinigames().includes(kind as DuelMinigameKind))
    throw new Error("Выбери дуэльную мини-игру");
  if (!Number.isSafeInteger(stake) || stake < 1 || stake > maxDuelStake(players, a.id, b.id))
    throw new Error("Ставка должна быть от 1 очка до 30% меньшего счёта соперников");
}
// A held challenge is never stacked; the five-answer cycle still advances.
export function earnsDuelChallenge(previous: number, current: number): boolean {
  return current > previous && Math.floor(current / 5) > Math.floor(previous / 5);
}
export function duelTransfers(event: DuelEvent, winnerId: string | null): Record<string, number> {
  if (winnerId === null) return {};
  if (![event.challengerId, event.opponentId].includes(winnerId))
    throw new Error("Неизвестный победитель дуэли");
  const loser = winnerId === event.challengerId ? event.opponentId : event.challengerId;
  return { [winnerId]: event.stake, [loser]: -event.stake };
}
export function duelWinner(snapshot: {
  phase: string;
  winnerIds?: string[];
  winnerId?: string | null;
  result?: { winnerId: string | null } | null;
}): string | null {
  if (snapshot.phase !== "complete") throw new Error("Дуэль ещё не завершена");
  return snapshot.winnerIds
    ? snapshot.winnerIds.length === 1
      ? snapshot.winnerIds[0]
      : null
    : (snapshot.result?.winnerId ?? snapshot.winnerId ?? null);
}

export type DuelSnapshot =
  | import("./memory").MemorySnapshot
  | import("./air-hockey").HockeySnapshot
  | import("./twenty-one").TwentyOneSnapshot
  | import("./number-hunt").NumberHuntSnapshot
  | import("./double-bluff").BluffSnapshot
  | import("./firefight").FirefightSnapshot;
