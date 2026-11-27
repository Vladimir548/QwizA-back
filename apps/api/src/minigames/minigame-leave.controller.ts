import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { Matches } from "class-validator";
import { MinigameRoomAccess } from "./minigame-room-access";

class LeaveMinigameDto {
  @Matches(/^[a-f0-9]{64}$/) token!: string;
}

@Controller("minigames")
export class MinigameLeaveController {
  constructor(private readonly rooms: MinigameRoomAccess) {}

  @Post(":game/:roomId/leave")
  @HttpCode(204)
  leave(
    @Param("game") game: string,
    @Param("roomId") roomId: string,
    @Body() body: LeaveMinigameDto,
  ) {
    this.rooms.leave(game, roomId, body.token);
  }
}
