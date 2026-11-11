import { Injectable } from "@nestjs/common";
import { randomInt, randomUUID } from "node:crypto";
import {
  addShootingPlayer,
  advanceShooting,
  applyShootingCommand,
  applyShootingCursor,
  createShootingMatch,
  shootingPublicState,
  type ShootingCommand,
  type ShootingCursorInput,
  type ShootingMatch,
  type ShootingSnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class ShootingService extends MinigameRooms<
  ShootingMatch,
  ShootingCommand,
  undefined,
  ShootingSnapshot
> {
  protected randomIndex: (upper: number) => number = randomInt;
  protected nextId: () => string = randomUUID;
  protected newMatch(_settings: undefined, roundId: string) {
    return createShootingMatch(roundId);
  }
  protected addPlayer = addShootingPlayer;
  protected advance(match: ShootingMatch, now: number) {
    advanceShooting(match, now, this.randomIndex, this.nextId);
  }
  protected presenceChanged(match: ShootingMatch, now: number) {
    this.advance(match, now);
  }
  protected apply(
    match: ShootingMatch,
    playerId: string,
    command: ShootingCommand,
    now: number,
    nextRoundId: string,
  ) {
    applyShootingCommand(match, playerId, command, now, nextRoundId, this.randomIndex, this.nextId);
  }
  protected view = shootingPublicState;
  protected deadline(match: ShootingMatch) {
    if (match.phase === "countdown") return match.startsAt;
    return match.phase === "running" ? Math.min(match.endsAt!, this.now() + 100) : null;
  }
  moveCursor(id: string, playerId: string, input: ShootingCursorInput) {
    this.updateInput(id, (match, now) => applyShootingCursor(match, playerId, input, now));
  }
}
