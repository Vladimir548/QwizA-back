import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CreateMinigameDto, JoinMinigameDto } from "./moment.dto";
import { FallingFloorService } from "./falling-floor.service";

@Controller("minigames/falling-floor")
export class FallingFloorController {
  constructor(private readonly fallingFloor: FallingFloorService) {}
  @Post()
  create(@Body() body: CreateMinigameDto) {
    return this.fallingFloor.create(body.displayName, undefined, body.roundCount);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.fallingFloor.join(id, body.displayName);
  }
}
