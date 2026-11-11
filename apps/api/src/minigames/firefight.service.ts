import { Injectable } from "@nestjs/common";
import {
  addFirefightPlayer,
  advanceFirefight,
  applyFirefightCommand,
  applyFirefightInput,
  createFirefightMatch,
  firefightPresenceChanged,
  firefightPublicState,
  type MinigameMode,
  type FirefightMatch,
  type FirefightCommand,
  type FirefightInput,
  type FirefightSnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";
@Injectable()
export class FirefightService extends MinigameRooms<
  FirefightMatch,
  FirefightCommand,
  { mode?: MinigameMode } | undefined,
  FirefightSnapshot
> {
  protected newMatch(settings: { mode?: MinigameMode } | undefined, roundId: string) {
    return createFirefightMatch(roundId, settings?.mode);
  }
  protected addPlayer = addFirefightPlayer;
  protected advance(match: FirefightMatch, now: number) {
    advanceFirefight(match, now);
  }
  protected presenceChanged(match: FirefightMatch, now: number) {
    firefightPresenceChanged(match, now);
  }
  protected apply(
    match: FirefightMatch,
    id: string,
    command: FirefightCommand,
    now: number,
    nextRoundId: string,
  ) {
    applyFirefightCommand(match, id, command, now, nextRoundId);
  }
  protected view = firefightPublicState;
  protected deadline(match: FirefightMatch) {
    return match.phase === "countdown"
      ? match.startsAt
      : match.phase === "running"
        ? this.now() + 40
        : null;
  }
  move(id: string, playerId: string, input: FirefightInput) {
    let accepted = false;
    this.updateInput(id, (match, now) => {
      accepted = applyFirefightInput(match, playerId, input, now);
    });
    return accepted;
  }
}
