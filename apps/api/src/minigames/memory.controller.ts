import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { MemoryService } from "./memory.service";
import { JoinMinigameDto } from "./moment.dto";

@Controller("minigames/memory")
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}
  @Post()
  create(@Body() body: JoinMinigameDto) {
    return this.memory.create(body.displayName, undefined);
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.memory.join(id, body.displayName);
  }
}
