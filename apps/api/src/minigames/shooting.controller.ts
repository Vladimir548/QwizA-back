import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { JoinMinigameDto } from "./moment.dto";
import { ShootingService } from "./shooting.service";

@Controller("minigames/shooting")
export class ShootingController {
  constructor(private readonly shooting: ShootingService) {}
  @Post()
  create(@Body() body: JoinMinigameDto) {
    return this.shooting.create(body.displayName, undefined);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.shooting.join(id, body.displayName);
  }
}
