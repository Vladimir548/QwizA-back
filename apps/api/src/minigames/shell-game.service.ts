import { Injectable } from "@nestjs/common";
import { randomInt, randomUUID } from "node:crypto";
import {
  addShellPlayer,
  advanceShell,
  applyShellCommand,
  createShellMatch,
  shellPublicState,
  type ShellMatch,
  type ShellCommand,
  type ShellSnapshot,
  type MinigameMode,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";
@Injectable()
export class ShellGameService extends MinigameRooms<
  ShellMatch,
  ShellCommand,
  { mode?: MinigameMode } | undefined,
  ShellSnapshot
> {
  protected randomIndex: (upper: number) => number = randomInt;
  protected newMatch(settings: { mode?: MinigameMode } | undefined, roundId: string) {
    return createShellMatch(roundId, settings?.mode);
  }
  protected addPlayer = addShellPlayer;
  protected advance(match: ShellMatch, now: number) {
    advanceShell(match, now, this.randomIndex, randomUUID);
  }
  protected apply(
    match: ShellMatch,
    id: string,
    command: ShellCommand,
    now: number,
    nextRoundId: string,
  ) {
    applyShellCommand(match, id, command, now, nextRoundId, this.randomIndex, randomUUID);
  }
  protected view = shellPublicState;
  protected deadline(match: ShellMatch) {
    return match.deadline;
  }
}
