import { Injectable } from "@nestjs/common";
import {
  HOCKEY,
  addHockeyPlayer,
  advanceHockey,
  applyHockeyCommand,
  applyHockeyInput,
  createHockeyMatch,
  hockeyPublicState,
  type HockeyCommand,
  type HockeyInput,
  type HockeyMatch,
  type HockeySnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class HockeyService extends MinigameRooms<
  HockeyMatch,
  HockeyCommand,
  undefined,
  HockeySnapshot
> {
  protected newMatch(_settings: undefined, roundId: string) {
    return createHockeyMatch(roundId);
  }
  protected addPlayer = addHockeyPlayer;
  protected advance = advanceHockey;
  protected presenceChanged = advanceHockey;
  protected apply = applyHockeyCommand;
  protected view = hockeyPublicState;
  protected deadline(match: HockeyMatch) {
    if (match.phase === "countdown") return match.serveAt;
    return match.phase === "playing" ? this.now() + HOCKEY.tickMs : null;
  }
  input(id: string, playerId: string, input: HockeyInput) {
    this.updateInput(id, (match) => applyHockeyInput(match, playerId, input));
  }
}
