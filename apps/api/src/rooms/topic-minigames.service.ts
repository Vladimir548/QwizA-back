import { MemoryService } from "../minigames/memory.service";
import { DoubleBluffService } from "../minigames/double-bluff.service";
import { FirefightService } from "../minigames/firefight.service";
import { HockeyService } from "../minigames/hockey.service";
import { TwentyOneService } from "../minigames/twenty-one.service";
import { NumberHuntService } from "../minigames/number-hunt.service";
import { Injectable, Optional } from "@nestjs/common";
import type {
  GroupMinigameKind,
  MinigameSession,
  TopicMinigameEvent,
  DuelEvent,
  DuelMinigameKind,
  MinigameKind,
} from "@qwiza/minigames";
import { topicMinigamePoints, duelWinner } from "@qwiza/minigames";
import { MomentService } from "../minigames/moment.service";
import { ZoneService } from "../minigames/zone.service";
import { ShootingService } from "../minigames/shooting.service";
import { FallingFloorService } from "../minigames/falling-floor.service";
import { SequenceService } from "../minigames/sequence.service";
import { RockfallService } from "../minigames/rockfall.service";

@Injectable()
export class TopicMinigamesService {
  private readonly matches = new Map<
    string,
    { kind: MinigameKind; sessions: Record<string, MinigameSession> }
  >();
  constructor(
    private readonly moments: MomentService,
    private readonly zones: ZoneService,
    private readonly shooting: ShootingService,
    private readonly floors: FallingFloorService,
    @Optional() private readonly memory?: MemoryService,
    @Optional() private readonly hockey?: HockeyService,
    @Optional() private readonly twentyOne?: TwentyOneService,
    @Optional() private readonly numberHunt?: NumberHuntService,
    @Optional() private readonly sequence?: SequenceService,
    @Optional() private readonly rockfall?: RockfallService,
    @Optional() private readonly bluff?: DoubleBluffService,
    @Optional() private readonly firefight?: FirefightService,
  ) {}
  private service(kind: GroupMinigameKind) {
    if (kind === "firefight") {
      if (!this.firefight) throw new Error("Сервис перестрелки недоступен");
      return this.firefight;
    }
    if (kind === "rockfall") {
      if (!this.rockfall) throw new Error("Сервис камнепада недоступен");
      return this.rockfall;
    }
    if (kind === "sequence") {
      if (!this.sequence) throw new Error("Сервис последовательностей недоступен");
      return this.sequence;
    }
    return kind === "moment"
      ? this.moments
      : kind === "zone"
        ? this.zones
        : kind === "shooting"
          ? this.shooting
          : this.floors;
  }
  ensure(roomId: string, event: TopicMinigameEvent, players: { id: string; name: string }[]) {
    const key = `${roomId}:${event.topicId}`;
    let match = this.matches.get(key);
    if (!match) {
      const kind = event.selected!;
      const service = this.service(kind);
      const sessions: Record<string, MinigameSession> = {};
      const first = players.find((player) => player.id === event.participantIds[0])!;
      const name = first.name.slice(0, 24);
      const session =
        kind === "firefight"
          ? this.firefight!.create(name, { mode: "group" })
          : kind === "rockfall"
            ? this.rockfall!.create(name, undefined)
            : kind === "sequence"
              ? this.sequence!.create(name, undefined)
              : kind === "moment"
                ? this.moments.create(name, { roundCount: 3 })
                : kind === "zone"
                  ? this.zones.create(name, undefined)
                  : kind === "shooting"
                    ? this.shooting.create(name, undefined)
                    : this.floors.create(name, undefined);
      sessions[first.id] = session;
      for (const id of event.participantIds.slice(1)) {
        const player = players.find((person) => person.id === id)!;
        sessions[id] = service.join(session.roomId, player.name.slice(0, 24));
      }
      service.seal(session.roomId);
      match = { kind, sessions };
      this.matches.set(key, match);
      // Minigame rooms use the same two-hour lifetime as standalone games.
      setTimeout(() => this.matches.delete(key), 2 * 60 * 60 * 1000).unref();
    }
    return match;
  }
  view(
    roomId: string,
    event: TopicMinigameEvent,
    players: { id: string; name: string }[],
    participantId?: string,
  ) {
    const match = this.ensure(roomId, event, players);
    const session = Object.values(match.sessions)[0];
    const snapshot = this.service(match.kind as GroupMinigameKind).snapshot(session.roomId);
    const points = topicMinigamePoints(snapshot.players).map((player) => ({
      participantId: Object.entries(match.sessions).find(
        ([, entry]) => entry.playerId === player.id,
      )![0],
      points: player.points,
    }));
    return {
      session: participantId ? (match.sessions[participantId] ?? null) : null,
      snapshot,
      points,
    };
  }

  duelView(
    roomId: string,
    event: DuelEvent,
    players: { id: string; name: string }[],
    participantId?: string,
  ) {
    const key = roomId + ":duel:" + event.id;
    let match = this.matches.get(key);
    const service = this.duelService(event.kind);
    if (!service) throw new Error("Сервис дуэлей недоступен");
    if (!match) {
      const sessions: Record<string, MinigameSession> = {};
      for (const id of [event.challengerId, event.opponentId]) {
        const name = players.find((p) => p.id === id)!.name.slice(0, 24);
        const first = Object.values(sessions)[0];
        sessions[id] = first ? service.join(first.roomId, name) : this.createDuel(event.kind, name);
      }
      service.seal(Object.values(sessions)[0].roomId);
      match = { kind: event.kind, sessions };
      this.matches.set(key, match);
      setTimeout(() => this.matches.delete(key), 2 * 60 * 60 * 1000).unref();
    }
    const session = participantId ? (match.sessions[participantId] ?? null) : null;
    const snapshot = service.snapshot(Object.values(match.sessions)[0].roomId, session?.playerId);
    const miniWinner = snapshot.phase === "complete" ? duelWinner(snapshot) : null;
    const winnerId = miniWinner
      ? Object.entries(match.sessions).find(([, s]) => s.playerId === miniWinner)![0]
      : null;
    return { session, snapshot, winnerId };
  }
  private duelService(kind: DuelMinigameKind) {
    if (kind === "firefight") return this.firefight!;
    if (kind === "double-bluff") return this.bluff!;
    return kind === "memory"
      ? this.memory!
      : kind === "hockey"
        ? this.hockey!
        : kind === "twenty-one"
          ? this.twentyOne!
          : this.numberHunt!;
  }
  private createDuel(kind: DuelMinigameKind, name: string) {
    if (kind === "firefight") return this.firefight!.create(name, { mode: "duel" });
    if (kind === "double-bluff") return this.bluff!.create(name, undefined);
    return kind === "memory"
      ? this.memory!.create(name, undefined)
      : kind === "hockey"
        ? this.hockey!.create(name, undefined)
        : kind === "twenty-one"
          ? this.twentyOne!.create(name, undefined)
          : this.numberHunt!.create(name, {});
  }
}
