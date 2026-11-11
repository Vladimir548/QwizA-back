import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";
import { MediaService } from "./media.service";
import { PacksRepository } from "./packs.repository";
import { PacksService } from "./packs.service";
import { WorkshopController } from "./workshop.controller";
import { MediaRepository } from "./media.repository";
import { SessionModule } from "../auth/session.service";
import { PackWorkflowService } from "./pack-workflow.service";
import { PackRatingsController } from "./pack-ratings.controller";
import { PackRatingsRepository } from "./pack-ratings.repository";
import { PackRatingsService } from "./pack-ratings.service";

@Module({
  imports: [
    SessionModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: Math.max(
            config.getOrThrow<number>("MEDIA_IMAGE_MAX_BYTES"),
            config.getOrThrow<number>("MEDIA_VIDEO_MAX_BYTES"),
          ),
          files: 1,
        },
      }),
    }),
  ],
  controllers: [WorkshopController, PackRatingsController],
  providers: [
    MediaService,
    MediaRepository,
    PacksRepository,
    PacksService,
    PackWorkflowService,
    PackRatingsRepository,
    PackRatingsService,
  ],
  exports: [PacksRepository],
})
export class WorkshopModule {}
