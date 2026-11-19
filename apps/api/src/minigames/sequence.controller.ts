import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CreateMinigameDto, JoinMinigameDto } from "./moment.dto";
import { SequenceService } from "./sequence.service";

@Controller("minigames/sequence")
export class SequenceController {
  constructor(private readonly sequence: SequenceService) {}
  @Post()
  create(@Body() body: CreateMinigameDto) {
    return this.sequence.create(body.displayName, undefined, body.roundCount);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.sequence.join(id, body.displayName);
  }
}
