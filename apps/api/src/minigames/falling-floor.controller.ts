import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { JoinMinigameDto } from "./moment.dto";
import { FallingFloorService } from "./falling-floor.service";

@Controller("minigames/falling-floor")
export class FallingFloorController {
  constructor(private readonly fallingFloor: FallingFloorService) {}
  @Post()
  create(@Body() body: JoinMinigameDto) {
    return this.fallingFloor.create(body.displayName, undefined);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.fallingFloor.join(id, body.displayName);
  }
}
