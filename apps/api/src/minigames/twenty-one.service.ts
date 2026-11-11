import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import {
  addTwentyOnePlayer,
  advanceTwentyOne,
  applyTwentyOneCommand,
  createTwentyOneMatch,
  twentyOneDeck,
  twentyOnePublicState,
  type TwentyOneCommand,
  type TwentyOneMatch,
  type TwentyOneSnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class TwentyOneService extends MinigameRooms<
  TwentyOneMatch,
  TwentyOneCommand,
  undefined,
  TwentyOneSnapshot
> {
  protected newMatch(_settings: undefined, roundId: string) {
    return createTwentyOneMatch(roundId, twentyOneDeck(randomInt));
  }
  protected addPlayer = addTwentyOnePlayer;
  protected advance = advanceTwentyOne;
  protected apply(
    match: TwentyOneMatch,
    playerId: string,
    command: TwentyOneCommand,
    now: number,
    nextRoundId: string,
  ) {
    applyTwentyOneCommand(match, playerId, command, now, nextRoundId, () =>
      twentyOneDeck(randomInt),
    );
  }
  protected view(match: TwentyOneMatch, playerId?: string) {
    return twentyOnePublicState(match, playerId, this.now());
  }
  protected deadline(match: TwentyOneMatch) {
    if (match.phase === "revealing") return match.resolvesAt;
    if (match.phase !== "dealing" && match.phase !== "playing") return null;
    const now = this.now();
    const deadlines = match.players.flatMap((p) => [
      ...p.cards.filter((c) => c.arrivesAt > now).map((c) => c.arrivesAt),
      ...(p.busyUntil !== null ? [p.busyUntil] : []),
    ]);
    return deadlines.length ? Math.min(...deadlines) : null;
  }
}
