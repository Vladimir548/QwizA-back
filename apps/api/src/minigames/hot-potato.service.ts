import { Injectable } from "@nestjs/common";
import {
  addHotPotatoPlayer,
  advanceHotPotato,
  applyHotPotatoCommand,
  applyHotPotatoInput,
  createHotPotato,
  hotPotatoPublicState,
  onHotPotatoPresenceChanged,
  HOT_POTATO_TICK_MS,
  type HotPotatoCommand,
  type HotPotatoInput,
  type HotPotatoMatch,
  type HotPotatoSnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class HotPotatoService extends MinigameRooms<
  HotPotatoMatch,
  HotPotatoCommand,
  undefined,
  HotPotatoSnapshot
> {
  protected newMatch(_settings: undefined, roundId: string) {
    return createHotPotato(roundId);
  }
  protected addPlayer = addHotPotatoPlayer;
  protected advance = advanceHotPotato;
  protected apply = applyHotPotatoCommand;
  protected view = hotPotatoPublicState;
  protected presenceChanged = onHotPotatoPresenceChanged;
  protected deadline(match: HotPotatoMatch) {
    if (match.phase === "countdown") return match.startsAt;
    return match.phase === "running"
      ? Math.min(this.now() + HOT_POTATO_TICK_MS, match.explodesAt!)
      : null;
  }
  move(id: string, playerId: string, input: HotPotatoInput) {
    this.updateInput(id, (match, now) => {
      applyHotPotatoInput(match, playerId, input, now);
    });
  }
}
