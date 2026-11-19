import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CreateMinigameDto, JoinMinigameDto } from "./moment.dto";
import { IceRaceService } from "./ice-race.service";

@Controller("minigames/ice-race")
export class IceRaceController {
  constructor(private readonly races: IceRaceService) {}
  @Post()
  create(@Body() body: CreateMinigameDto) {
    return this.races.create(body.displayName, undefined, body.roundCount);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.races.join(id, body.displayName);
  }
}
