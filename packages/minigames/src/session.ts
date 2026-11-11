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
  | "double-bluff"
  | "firefight";

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

export interface MinigameSnapshot {
  id: string;
  code: string;
  revision: number;
  serverTime: number;
  roundId: string;
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
