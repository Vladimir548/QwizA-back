import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnvironment } from "./config/environment";
import { HealthModule } from "./health/health.module";
import { WorkshopModule } from "./workshop/workshop.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RoomsModule } from "./rooms/rooms.module";
import { AuthModule } from "./auth/auth.module";
import { MinigamesModule } from "./minigames/minigames.module";
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
    HealthModule,
    WorkshopModule,
    RoomsModule,
    AuthModule,
    MinigamesModule,
  ],
})
export class AppModule {}
