export type MinigameKind =
  | "moment"
  | "memory"
  | "hockey"
  | "zone"
  | "twenty-one"
  | "shooting"
  | "number-hunt"
  | "falling-floor"
  | "sequence"
  | "rockfall"
  | "hot-potato"
  | "ice-race"
  | "double-bluff"
  | "firefight"
  | "shell-game";

export interface MinigamePlayer {
  id: string;
  name: string;
  score: number;
  ready: boolean;
  connected: boolean;
}

export interface MinigameSession {
  roomId: string;
  playerId: string;
  token: string;
}

export const MAX_MINIGAME_NAME_LENGTH = 40;
export const MIN_MINIGAME_ROUNDS = 1;
export const MAX_MINIGAME_ROUNDS = 10;
export const QUIZ_MINIGAME_ROUNDS = 3;

export function isMinigameRoundCount(value: number) {
  return Number.isInteger(value) && value >= MIN_MINIGAME_ROUNDS && value <= MAX_MINIGAME_ROUNDS;
}

export interface MinigameSeries {
  round: number;
  roundCount: number;
  wins: Record<string, number>;
}

export function isMinigameComplete(snapshot: { phase: string; series?: MinigameSeries }) {
  return (
    snapshot.phase === "complete" &&
    (!snapshot.series || snapshot.series.round === snapshot.series.roundCount)
  );
}

export interface MinigameSnapshot {
  id: string;
  code: string;
  revision: number;
  serverTime: number;
  roundId: string;
  series?: MinigameSeries;
}

export interface MinigameCommand {
  id: string;
  roundId: string;
}

export interface MinigameAck<Snapshot> {
  ok: boolean;
  error?: string;
  snapshot?: Snapshot;
}
