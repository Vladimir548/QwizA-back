import { IsIn, IsString, Length } from "class-validator";

export class JoinMinigameDto {
  @IsString() @Length(1, 24) displayName!: string;
}

export class CreateMomentDto extends JoinMinigameDto {
  @IsIn([3, 5, 7]) roundCount!: number;
}
