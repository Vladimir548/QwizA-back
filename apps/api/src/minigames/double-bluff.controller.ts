import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { JoinMinigameDto } from "./moment.dto";
import { DoubleBluffService } from "./double-bluff.service";

@Controller("minigames/double-bluff")
export class DoubleBluffController {
  constructor(private readonly game: DoubleBluffService) {}
  @Post()
  create(@Body() body: JoinMinigameDto) {
    return this.game.create(body.displayName, undefined);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.game.join(id, body.displayName);
  }
}
