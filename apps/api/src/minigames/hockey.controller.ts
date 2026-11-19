import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { HockeyService } from "./hockey.service";
import { CreateMinigameDto, JoinMinigameDto } from "./moment.dto";

@Controller("minigames/hockey")
export class HockeyController {
  constructor(private readonly hockey: HockeyService) {}
  @Post()
  create(@Body() body: CreateMinigameDto) {
    return this.hockey.create(body.displayName, undefined, body.roundCount);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.hockey.join(id, body.displayName);
  }
}
