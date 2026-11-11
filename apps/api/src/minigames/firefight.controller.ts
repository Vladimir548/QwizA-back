import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { IsIn, IsOptional } from "class-validator";
import { JoinMinigameDto } from "./moment.dto";
import { FirefightService } from "./firefight.service";

class CreateFirefightDto extends JoinMinigameDto {
  @IsOptional()
  @IsIn(["duel", "group"])
  mode?: "duel" | "group";
}

@Controller("minigames/firefight")
export class FirefightController {
  constructor(private readonly firefight: FirefightService) {}
  @Post()
  create(@Body() body: CreateFirefightDto) {
    return this.firefight.create(body.displayName, { mode: body.mode });
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.firefight.join(id, body.displayName);
  }
}
