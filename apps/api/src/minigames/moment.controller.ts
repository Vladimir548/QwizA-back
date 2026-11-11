import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { MomentService } from "./moment.service";
import { CreateMomentDto, JoinMinigameDto } from "./moment.dto";

@Controller("minigames/moment")
export class MomentController {
  constructor(private readonly moments: MomentService) {}

  @Post()
  create(@Body() body: CreateMomentDto) {
    return this.moments.create(body.displayName, {
      roundCount: body.roundCount,
    });
  }

  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.moments.join(id, body.displayName);
  }
}
