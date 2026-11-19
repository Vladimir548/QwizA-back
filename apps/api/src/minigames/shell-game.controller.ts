import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { IsIn, IsOptional } from "class-validator";
import { CreateMinigameDto, JoinMinigameDto } from "./moment.dto";
import { ShellGameService } from "./shell-game.service";
class CreateShellGameDto extends CreateMinigameDto {
  @IsOptional() @IsIn(["duel", "group"]) mode?: "duel" | "group";
}
@Controller("minigames/shell-game")
export class ShellGameController {
  constructor(private readonly shells: ShellGameService) {}
  @Post() create(@Body() body: CreateShellGameDto) {
    return this.shells.create(body.displayName, { mode: body.mode }, body.roundCount);
  }
  @Post(":id/join") join(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: JoinMinigameDto,
  ) {
    return this.shells.join(id, body.displayName);
  }
}
