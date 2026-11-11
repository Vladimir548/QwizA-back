import { Module } from "@nestjs/common";
import { SessionModule } from "../auth/session.service";
import { WorkshopModule } from "../workshop/workshop.module";
import { RoomsController } from "./rooms.controller";
import { RoomsGateway } from "./rooms.gateway";
import { PlayerMediaGateway } from "./player-media.gateway";
import { RoomsService } from "./rooms.service";
import { MinigamesModule } from "../minigames/minigames.module";
import { TopicMinigamesService } from "./topic-minigames.service";
import { LivekitService } from "./livekit.service";

@Module({
  imports: [WorkshopModule, MinigamesModule, SessionModule],
  controllers: [RoomsController],
  providers: [
    RoomsService,
    RoomsGateway,
    PlayerMediaGateway,
    TopicMinigamesService,
    LivekitService,
  ],
  exports: [RoomsService, PlayerMediaGateway],
})
export class RoomsModule {}
