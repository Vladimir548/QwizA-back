import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { IsIn, IsOptional } from "class-validator";
import { CreateMinigameDto, JoinMinigameDto } from "./moment.dto";
import { FirefightService } from "./firefight.service";

class CreateFirefightDto extends CreateMinigameDto {
  @IsOptional()
  @IsIn(["duel", "group"])
  mode?: "duel" | "group";
}

@Controller("minigames/firefight")
export class FirefightController {
  constructor(private readonly firefight: FirefightService) {}
  @Post()
  create(@Body() body: CreateFirefightDto) {
    return this.firefight.create(body.displayName, { mode: body.mode }, body.roundCount);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.firefight.join(id, body.displayName);
  }
}
