import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { IsInt, Max, Min, ValidateIf } from "class-validator";
import { JoinMinigameDto } from "./moment.dto";
import { NumberHuntService } from "./number-hunt.service";

export class CreateNumberHuntDto extends JoinMinigameDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(6)
  @Max(20)
  numberCount?: number;
}

@Controller("minigames/number-hunt")
export class NumberHuntController {
  constructor(private readonly numberHunt: NumberHuntService) {}
  @Post()
  create(@Body() body: CreateNumberHuntDto) {
    return this.numberHunt.create(body.displayName, {
      numberCount: body.numberCount,
    });
  }
  @Post(":id/join")
  join(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: JoinMinigameDto) {
    return this.numberHunt.join(id, body.displayName);
  }
}
