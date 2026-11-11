import { IsInt, Max, Min } from "class-validator";

export class PackRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  value!: number;
}
