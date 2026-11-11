import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import {
  addBluffPlayer,
  advanceBluff,
  applyBluffCommand,
  bluffPresenceChanged,
  bluffPublicState,
  createBluffMatch,
  type BluffMatch,
  type BluffCommand,
  type BluffSnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class DoubleBluffService extends MinigameRooms<
  BluffMatch,
  BluffCommand,
  undefined,
  BluffSnapshot
> {
  protected newMatch(_settings: undefined, roundId: string) {
    return createBluffMatch(roundId);
  }
  protected addPlayer = addBluffPlayer;
  protected advance = advanceBluff;
  protected presenceChanged = bluffPresenceChanged;
  protected view = bluffPublicState;
  protected deadline(match: BluffMatch) {
    return match.deadline;
  }
  protected apply(
    match: BluffMatch,
    playerId: string,
    command: BluffCommand,
    now: number,
    nextRoundId: string,
  ) {
    applyBluffCommand(match, playerId, command, now, nextRoundId, randomInt);
  }
}
