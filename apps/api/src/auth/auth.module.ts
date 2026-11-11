import { Module } from "@nestjs/common";
import { RoomsModule } from "../rooms/rooms.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionModule } from "./session.service";
import { AdminUsersController } from "./admin-users.controller";
import { AdminUsersService } from "./admin-users.service";

@Module({
  imports: [RoomsModule, SessionModule],
  controllers: [AuthController, AdminUsersController],
  providers: [AuthService, AdminUsersService],
})
export class AuthModule {}
