import { MAX_MINIGAME_ROUNDS, MIN_MINIGAME_ROUNDS } from "@qwiza/minigames";
import { IsInt, IsString, Length, Max, Min, ValidateIf } from "class-validator";

export class JoinMinigameDto {
  @IsString() @Length(1, 24) displayName!: string;
}

export class CreateMinigameDto extends JoinMinigameDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(MIN_MINIGAME_ROUNDS)
  @Max(MAX_MINIGAME_ROUNDS)
  roundCount?: number;
}
