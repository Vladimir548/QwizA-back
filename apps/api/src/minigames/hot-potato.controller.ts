import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CreateMinigameDto, JoinMinigameDto } from "./moment.dto";
import { HotPotatoService } from "./hot-potato.service";

@Controller("minigames/hot-potato")
export class HotPotatoController {
  constructor(private readonly games: HotPotatoService) {}
  @Post()
  create(@Body() body: CreateMinigameDto) {
    return this.games.create(body.displayName, undefined, body.roundCount);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.games.join(id, body.displayName);
  }
}
