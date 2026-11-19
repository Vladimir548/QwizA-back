import { Injectable } from "@nestjs/common";
import {
  addIceRacer,
  advanceIceRace,
  applyIceRaceCommand,
  applyIceRaceInput,
  createIceRace,
  iceRacePublicState,
  ICE_RACE_TICK_MS,
  type IceRaceCommand,
  type IceRaceInput,
  type IceRaceMatch,
  type IceRaceSnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class IceRaceService extends MinigameRooms<
  IceRaceMatch,
  IceRaceCommand,
  undefined,
  IceRaceSnapshot
> {
  protected newMatch(_settings: undefined, roundId: string) {
    return createIceRace(roundId);
  }
  protected addPlayer = addIceRacer;
  protected advance = advanceIceRace;
  protected apply = applyIceRaceCommand;
  protected view = iceRacePublicState;
  protected presenceChanged(match: IceRaceMatch) {
    for (const player of match.players) {
      const motion = match.motion[player.id];
      if (!player.connected && motion) motion.input = null;
    }
  }
  protected deadline(match: IceRaceMatch) {
    if (match.phase === "countdown") return match.startsAt;
    return match.phase === "running"
      ? Math.min(this.now() + ICE_RACE_TICK_MS, match.endsAt!)
      : null;
  }
  move(id: string, playerId: string, input: IceRaceInput) {
    this.updateInput(id, (match, now) => {
      applyIceRaceInput(match, playerId, input, now);
    });
  }
}
