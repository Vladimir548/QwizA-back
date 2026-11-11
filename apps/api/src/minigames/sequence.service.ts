import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import {
  createSequenceMatch,
  addSequencePlayer,
  advanceSequence,
  applySequenceCommand,
  sequencePublicState,
  type SequenceMatch,
  type SequenceCommand,
  type SequenceSnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";
@Injectable()
export class SequenceService extends MinigameRooms<
  SequenceMatch,
  SequenceCommand,
  undefined,
  SequenceSnapshot
> {
  protected randomIndex: (upper: number) => number = randomInt;
  protected newMatch(_settings: undefined, roundId: string) {
    return createSequenceMatch(roundId);
  }
  protected addPlayer = addSequencePlayer;
  protected advance(match: SequenceMatch, now: number) {
    advanceSequence(match, now, this.randomIndex);
  }
  protected apply(
    match: SequenceMatch,
    playerId: string,
    command: SequenceCommand,
    now: number,
    nextRoundId: string,
  ) {
    applySequenceCommand(match, playerId, command, now, nextRoundId, this.randomIndex);
  }
  protected view = sequencePublicState;
  protected deadline(match: SequenceMatch) {
    return match.deadline;
  }
}
