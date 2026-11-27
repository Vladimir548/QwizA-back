import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import {
  addOddEvenPlayer,
  advanceOddEven,
  applyOddEvenCommand,
  createOddEvenMatch,
  oddEvenPublicState,
  type MinigameMode,
  type OddEvenCommand,
  type OddEvenMatch,
  type OddEvenSnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class OddEvenService extends MinigameRooms<
  OddEvenMatch,
  OddEvenCommand,
  { mode?: MinigameMode } | undefined,
  OddEvenSnapshot
> {
  protected newMatch(settings: { mode?: MinigameMode } | undefined, roundId: string) {
    return createOddEvenMatch(roundId, settings?.mode);
  }
  protected addPlayer = addOddEvenPlayer;
  protected view = oddEvenPublicState;

  protected deadline(match: OddEvenMatch) {
    return match.deadline;
  }
  protected advance(match: OddEvenMatch, now: number) {
    advanceOddEven(match, now, randomInt);
  }
  protected apply(
    match: OddEvenMatch,
    playerId: string,
    command: OddEvenCommand,
    now: number,
    nextRoundId: string,
  ) {
    applyOddEvenCommand(match, playerId, command, now, nextRoundId, randomInt);
  }
}
