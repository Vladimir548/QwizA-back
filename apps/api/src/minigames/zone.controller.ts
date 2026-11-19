import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ZoneService } from "./zone.service";
import { CreateMinigameDto, JoinMinigameDto } from "./moment.dto";

@Controller("minigames/zone")
export class ZoneController {
  constructor(private readonly zone: ZoneService) {}
  @Post()
  create(@Body() body: CreateMinigameDto) {
    return this.zone.create(body.displayName, undefined, body.roundCount);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.zone.join(id, body.displayName);
  }
}
