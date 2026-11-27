import { Injectable, UnauthorizedException, type Type } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { isUUID } from "class-validator";
import type { MinigameKind } from "@qwiza/minigames";
import { DoubleBluffService } from "./double-bluff.service";
import { FallingFloorService } from "./falling-floor.service";
import { FirefightService } from "./firefight.service";
import { HockeyService } from "./hockey.service";
import { HotPotatoService } from "./hot-potato.service";
import { IceRaceService } from "./ice-race.service";
import { MemoryService } from "./memory.service";
import { MomentService } from "./moment.service";
import { NumberHuntService } from "./number-hunt.service";
import { OddEvenService } from "./odd-even.service";
import { RockfallService } from "./rockfall.service";
import { SequenceService } from "./sequence.service";
import { ShellGameService } from "./shell-game.service";
import { ShootingService } from "./shooting.service";
import { TwentyOneService } from "./twenty-one.service";
import { ZoneService } from "./zone.service";

type RoomService = {
  authenticate(id: string, token: unknown): string;
  leave(id: string, playerId: string): void;
};

const rooms: Record<MinigameKind, Type<RoomService>> = {
  "double-bluff": DoubleBluffService,
  "falling-floor": FallingFloorService,
  firefight: FirefightService,
  hockey: HockeyService,
  "hot-potato": HotPotatoService,
  "ice-race": IceRaceService,
  memory: MemoryService,
  moment: MomentService,
  "number-hunt": NumberHuntService,
  "odd-even": OddEvenService,
  rockfall: RockfallService,
  sequence: SequenceService,
  "shell-game": ShellGameService,
  shooting: ShootingService,
  "twenty-one": TwentyOneService,
  zone: ZoneService,
};

@Injectable()
export class MinigameRoomAccess {
  constructor(private readonly module: ModuleRef) {}

  authenticate(game: string, roomId: string, token: string) {
    return this.service(game, roomId).authenticate(roomId, token);
  }

  leave(game: string, roomId: string, token: string) {
    const service = this.service(game, roomId);
    service.leave(roomId, service.authenticate(roomId, token));
  }

  private service(game: string, roomId: string) {
    if (!Object.hasOwn(rooms, game) || !isUUID(roomId))
      throw new UnauthorizedException("Неверный стол мини-игры");
    return this.module.get(rooms[game as MinigameKind]);
  }
}
