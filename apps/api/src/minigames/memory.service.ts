import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import {
  addMemoryPlayer,
  advanceMemory,
  applyMemoryCommand,
  createMemoryMatch,
  memoryDeck,
  memoryPublicState,
} from "@qwiza/minigames";
import type { MemoryCommand, MemoryMatch, MemorySnapshot } from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class MemoryService extends MinigameRooms<
  MemoryMatch,
  MemoryCommand,
  undefined,
  MemorySnapshot
> {
  protected newMatch(_settings: undefined, roundId: string) {
    return createMemoryMatch(roundId, memoryDeck(randomInt));
  }
  protected addPlayer = addMemoryPlayer;
  protected advance = advanceMemory;
  protected apply(
    match: MemoryMatch,
    playerId: string,
    command: MemoryCommand,
    now: number,
    nextRoundId: string,
  ) {
    applyMemoryCommand(match, playerId, command, now, nextRoundId, () => memoryDeck(randomInt));
  }
  protected view = memoryPublicState;
  protected deadline(match: MemoryMatch) {
    return match.revealsAt;
  }
}
