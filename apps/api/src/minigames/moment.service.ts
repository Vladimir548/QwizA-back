import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import {
  addMomentPlayer,
  advanceMoment,
  applyMomentCommand,
  createMomentMatch,
  momentPublicState,
} from "@qwiza/minigames";
import type { MomentCommand, MomentMatch, MomentSettings, MomentSnapshot } from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class MomentService extends MinigameRooms<
  MomentMatch,
  MomentCommand,
  Pick<MomentSettings, "roundCount">,
  MomentSnapshot
> {
  protected newMatch(settings: Pick<MomentSettings, "roundCount">, roundId: string) {
    return createMomentMatch(
      { roundCount: settings.roundCount, targetMs: randomInt(3, 11) * 1000 },
      roundId,
    );
  }
  protected addPlayer = addMomentPlayer;
  protected advance = advanceMoment;
  protected apply(
    match: MomentMatch,
    playerId: string,
    command: MomentCommand,
    now: number,
    nextRoundId: string,
  ) {
    applyMomentCommand(match, playerId, command, now, nextRoundId, randomInt(3, 11) * 1000);
  }
  protected view(match: MomentMatch, playerId?: string) {
    return {
      ...momentPublicState(match),
      ...(playerId
        ? {
            ownElapsedMs:
              match.attempts.find((attempt) => attempt.playerId === playerId)?.elapsedMs ?? null,
          }
        : {}),
    };
  }
  protected deadline(match: MomentMatch) {
    return match.phase === "countdown"
      ? match.startsAt
      : match.phase === "running"
        ? match.endsAt
        : null;
  }
}
