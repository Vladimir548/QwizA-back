import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import {
  addRockfallPlayer,
  advanceRockfall,
  applyRockfallCommand,
  applyRockfallInput,
  createRockfallMatch,
  rockfallPresenceChanged,
  rockfallPublicState,
  type RockfallCommand,
  type RockfallInput,
  type RockfallMatch,
  type RockfallSnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class RockfallService extends MinigameRooms<
  RockfallMatch,
  RockfallCommand,
  undefined,
  RockfallSnapshot
> {
  protected randomIndex: (upper: number) => number = randomInt;
  protected newMatch(_settings: undefined, roundId: string) {
    return createRockfallMatch(roundId);
  }
  protected addPlayer = addRockfallPlayer;
  protected advance(match: RockfallMatch, now: number) {
    advanceRockfall(match, now, this.randomIndex);
  }
  protected presenceChanged(match: RockfallMatch, now: number) {
    rockfallPresenceChanged(match, now, this.randomIndex);
  }
  protected apply(
    match: RockfallMatch,
    playerId: string,
    command: RockfallCommand,
    now: number,
    nextRoundId: string,
  ) {
    applyRockfallCommand(match, playerId, command, now, nextRoundId, this.randomIndex);
  }
  protected view = rockfallPublicState;
  protected deadline(match: RockfallMatch) {
    if (match.phase === "countdown") return match.startsAt;
    return match.phase === "running" ? this.now() + 40 : null;
  }
  move(id: string, playerId: string, input: RockfallInput) {
    let accepted = false;
    this.updateInput(id, (match, now) => {
      accepted = applyRockfallInput(match, playerId, input, now, this.randomIndex);
    });
    return accepted;
  }
}
