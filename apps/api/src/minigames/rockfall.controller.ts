import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { JoinMinigameDto } from "./moment.dto";
import { RockfallService } from "./rockfall.service";

@Controller("minigames/rockfall")
export class RockfallController {
  constructor(private readonly rockfall: RockfallService) {}
  @Post()
  create(@Body() body: JoinMinigameDto) {
    return this.rockfall.create(body.displayName, undefined);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.rockfall.join(id, body.displayName);
  }
}
