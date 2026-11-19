import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { TwentyOneService } from "./twenty-one.service";
import { CreateMinigameDto, JoinMinigameDto } from "./moment.dto";

@Controller("minigames/twenty-one")
export class TwentyOneController {
  constructor(private readonly game: TwentyOneService) {}
  @Post()
  create(@Body() body: CreateMinigameDto) {
    return this.game.create(body.displayName, undefined, body.roundCount);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.game.join(id, body.displayName);
  }
}
