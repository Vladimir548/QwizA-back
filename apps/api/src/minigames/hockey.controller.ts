import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { HockeyService } from "./hockey.service";
import { JoinMinigameDto } from "./moment.dto";

@Controller("minigames/hockey")
export class HockeyController {
  constructor(private readonly hockey: HockeyService) {}
  @Post()
  create(@Body() body: JoinMinigameDto) {
    return this.hockey.create(body.displayName, undefined);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.hockey.join(id, body.displayName);
  }
}
