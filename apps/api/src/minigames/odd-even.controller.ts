import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { IsIn, IsOptional } from "class-validator";
import type { MinigameMode } from "@qwiza/minigames";
import { CreateMinigameDto, JoinMinigameDto } from "./moment.dto";
import { OddEvenService } from "./odd-even.service";

class CreateOddEvenDto extends CreateMinigameDto {
  @IsOptional()
  @IsIn(["duel", "group"])
  mode?: MinigameMode;
}

@Controller("minigames/odd-even")
export class OddEvenController {
  constructor(private readonly game: OddEvenService) {}

  @Post()
  create(@Body() body: CreateOddEvenDto) {
    return this.game.create(body.displayName, { mode: body.mode }, body.roundCount);
  }

  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.game.join(id, body.displayName);
  }
}
