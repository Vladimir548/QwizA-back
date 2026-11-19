import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { MomentService } from "./moment.service";
import { MOMENT_DEFAULT_ROUNDS } from "@qwiza/minigames";
import { CreateMinigameDto, JoinMinigameDto } from "./moment.dto";

@Controller("minigames/moment")
export class MomentController {
  constructor(private readonly moments: MomentService) {}

  @Post()
  create(@Body() body: CreateMinigameDto) {
    return this.moments.create(body.displayName, {
      roundCount: body.roundCount ?? MOMENT_DEFAULT_ROUNDS,
    });
  }

  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.moments.join(id, body.displayName);
  }
}
