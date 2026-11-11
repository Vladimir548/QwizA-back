import { Injectable } from "@nestjs/common";
import { randomInt, randomUUID } from "node:crypto";
import {
  addZonePlayer,
  advanceZone,
  applyZoneCommand,
  createZoneMatch,
  randomZoneCheck,
  zonePublicState,
  type ZoneCommand,
  type ZoneCheck,
  type ZoneMatch,
  type ZoneSnapshot,
} from "@qwiza/minigames";
import { MinigameRooms } from "./minigame-rooms";

@Injectable()
export class ZoneService extends MinigameRooms<ZoneMatch, ZoneCommand, undefined, ZoneSnapshot> {
  protected newTarget = (previous?: ZoneCheck | null) => ({
    id: randomUUID(),
    check: randomZoneCheck(randomInt, previous),
  });
  protected newMatch(_settings: undefined, roundId: string) {
    return createZoneMatch(roundId);
  }
  protected addPlayer = addZonePlayer;
  protected advance(match: ZoneMatch, now: number) {
    advanceZone(match, now);
  }
  protected apply(
    match: ZoneMatch,
    playerId: string,
    command: ZoneCommand,
    now: number,
    nextRoundId: string,
  ) {
    applyZoneCommand(match, playerId, command, now, nextRoundId, this.newTarget);
  }
  protected view = zonePublicState;
  protected deadline(match: ZoneMatch) {
    if (match.phase === "countdown") return match.startsAt;
    if (match.phase !== "running") return null;
    const pauses = match.players.flatMap((p) => (p.resumeAt === null ? [] : [p.resumeAt]));
    return pauses.length ? Math.min(...pauses) : null;
  }
}
