import { Module } from "@nestjs/common";
import { MinigameRoomAccess } from "./minigame-room-access";
import { MinigameLeaveController } from "./minigame-leave.controller";
import { OddEvenController } from "./odd-even.controller";
import { OddEvenGateway } from "./odd-even.gateway";
import { OddEvenService } from "./odd-even.service";
import { HotPotatoService } from "./hot-potato.service";
import { IceRaceService } from "./ice-race.service";
import { HotPotatoController } from "./hot-potato.controller";
import { IceRaceController } from "./ice-race.controller";
import { HotPotatoGateway } from "./hot-potato.gateway";
import { IceRaceGateway } from "./ice-race.gateway";
import { ShellGameService } from "./shell-game.service";
import { ShellGameController } from "./shell-game.controller";
import { ShellGameGateway } from "./shell-game.gateway";
import { FirefightService } from "./firefight.service";
import { FirefightController } from "./firefight.controller";
import { FirefightGateway } from "./firefight.gateway";
import { DoubleBluffService } from "./double-bluff.service";
import { DoubleBluffController } from "./double-bluff.controller";
import { DoubleBluffGateway } from "./double-bluff.gateway";
import { SequenceService } from "./sequence.service";
import { SequenceController } from "./sequence.controller";
import { SequenceGateway } from "./sequence.gateway";
import { RockfallService } from "./rockfall.service";
import { RockfallController } from "./rockfall.controller";
import { RockfallGateway } from "./rockfall.gateway";
import { MomentService } from "./moment.service";
import { MomentController } from "./moment.controller";
import { MomentGateway } from "./moment.gateway";
import { MemoryService } from "./memory.service";
import { MemoryController } from "./memory.controller";
import { MemoryGateway } from "./memory.gateway";
import { HockeyService } from "./hockey.service";
import { HockeyController } from "./hockey.controller";
import { HockeyGateway } from "./hockey.gateway";
import { ZoneService } from "./zone.service";
import { ZoneController } from "./zone.controller";
import { ZoneGateway } from "./zone.gateway";
import { TwentyOneService } from "./twenty-one.service";
import { TwentyOneController } from "./twenty-one.controller";
import { TwentyOneGateway } from "./twenty-one.gateway";
import { ShootingService } from "./shooting.service";
import { ShootingController } from "./shooting.controller";
import { ShootingGateway } from "./shooting.gateway";
import { NumberHuntService } from "./number-hunt.service";
import { NumberHuntController } from "./number-hunt.controller";
import { NumberHuntGateway } from "./number-hunt.gateway";
import { FallingFloorService } from "./falling-floor.service";
import { FallingFloorController } from "./falling-floor.controller";
import { FallingFloorGateway } from "./falling-floor.gateway";

@Module({
  exports: [
    MinigameRoomAccess,
    OddEvenService,
    HotPotatoService,
    IceRaceService,
    ShellGameService,
    FirefightService,
    DoubleBluffService,
    RockfallService,
    SequenceService,
    MomentService,
    ZoneService,
    ShootingService,
    FallingFloorService,
    MemoryService,
    HockeyService,
    TwentyOneService,
    NumberHuntService,
  ],
  providers: [
    MinigameRoomAccess,
    OddEvenService,
    OddEvenGateway,
    HotPotatoService,
    IceRaceService,
    HotPotatoGateway,
    IceRaceGateway,
    ShellGameService,
    ShellGameGateway,
    FirefightService,
    FirefightGateway,
    DoubleBluffService,
    DoubleBluffGateway,
    RockfallService,
    RockfallGateway,
    SequenceService,
    SequenceGateway,
    MomentService,
    MomentGateway,
    MemoryService,
    MemoryGateway,
    HockeyService,
    HockeyGateway,
    ZoneService,
    ZoneGateway,
    TwentyOneService,
    TwentyOneGateway,
    ShootingService,
    ShootingGateway,
    NumberHuntService,
    NumberHuntGateway,
    FallingFloorService,
    FallingFloorGateway,
  ],
  controllers: [
    MinigameLeaveController,
    OddEvenController,
    HotPotatoController,
    IceRaceController,
    ShellGameController,
    FirefightController,
    DoubleBluffController,
    RockfallController,
    SequenceController,
    MomentController,
    MemoryController,
    HockeyController,
    ZoneController,
    TwentyOneController,
    ShootingController,
    NumberHuntController,
    FallingFloorController,
  ],
})
export class MinigamesModule {}
