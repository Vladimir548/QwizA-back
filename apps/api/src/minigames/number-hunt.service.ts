import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import {
  addNumberHuntPlayer,
  advanceNumberHunt,
  applyNumberHuntCommand,
  createNumberHuntMatch,
  numberHuntDeck,
  numberHuntPublicState,
  numberHuntSettings,
} from "@qwiza/minigames";
import type {
  NumberHuntCommand,
  NumberHuntMatch,
  NumberHuntSettings,
  NumberHuntSnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class NumberHuntService extends MinigameRooms<
  NumberHuntMatch,
  NumberHuntCommand,
  Partial<NumberHuntSettings>,
  NumberHuntSnapshot
> {
  protected newMatch(input: Partial<NumberHuntSettings>, roundId: string) {
    const settings = numberHuntSettings(input);
    return createNumberHuntMatch(
      roundId,
      settings,
      numberHuntDeck(settings.numberCount, randomInt),
    );
  }
  protected addPlayer = addNumberHuntPlayer;
  protected advance = advanceNumberHunt;
  protected apply(
    match: NumberHuntMatch,
    playerId: string,
    command: NumberHuntCommand,
    now: number,
    nextRoundId: string,
  ) {
    applyNumberHuntCommand(match, playerId, command, now, nextRoundId, () =>
      numberHuntDeck(match.settings.numberCount, randomInt),
    );
  }
  protected view = numberHuntPublicState;
  protected deadline(match: NumberHuntMatch) {
    return match.revealsAt;
  }
}
