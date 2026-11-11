import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import {
  addFallingFloorPlayer,
  advanceFallingFloor,
  applyFallingFloorCommand,
  applyFallingFloorInput,
  createFallingFloorMatch,
  fallingFloorPresenceChanged,
  fallingFloorPublicState,
  FALLING_FLOOR_TICK_MS,
  type FallingFloorCommand,
  type FallingFloorInput,
  type FallingFloorMatch,
  type FallingFloorSnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class FallingFloorService extends MinigameRooms<
  FallingFloorMatch,
  FallingFloorCommand,
  undefined,
  FallingFloorSnapshot
> {
  protected randomIndex: (upper: number) => number = randomInt;
  protected newMatch(_settings: undefined, roundId: string) {
    return createFallingFloorMatch(roundId);
  }
  protected addPlayer = addFallingFloorPlayer;
  protected advance(match: FallingFloorMatch, now: number) {
    advanceFallingFloor(match, now, this.randomIndex);
  }
  protected presenceChanged(match: FallingFloorMatch, now: number) {
    fallingFloorPresenceChanged(match, now, this.randomIndex);
  }
  protected apply(
    match: FallingFloorMatch,
    playerId: string,
    command: FallingFloorCommand,
    now: number,
    nextRoundId: string,
  ) {
    applyFallingFloorCommand(match, playerId, command, now, nextRoundId, this.randomIndex);
  }
  protected view = fallingFloorPublicState;
  protected deadline(match: FallingFloorMatch) {
    if (match.phase === "countdown") return match.startsAt;
    return match.phase === "running" ? this.now() + FALLING_FLOOR_TICK_MS : null;
  }
  move(id: string, playerId: string, input: FallingFloorInput) {
    let accepted = false;
    this.updateInput(id, (match, now) => {
      accepted = applyFallingFloorInput(match, playerId, input, now, this.randomIndex);
    });
    return accepted;
  }
}
