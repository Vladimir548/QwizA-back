import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  ValidateNested,
  IsOptional,
} from "class-validator";
import { VICTORY_CRITERION_IDS, type VictoryCriterion } from "@qwiza/minigames";

export class VictoryRulesDto {
  @IsIn(["score", "achievements"]) mode!: "score" | "achievements";
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(VICTORY_CRITERION_IDS.length)
  @ArrayUnique()
  @IsIn(VICTORY_CRITERION_IDS, { each: true })
  criteria!: VictoryCriterion[];
}
export class VictorySettingsDto {
  @IsOptional() @ValidateNested() @Type(() => VictoryRulesDto) victory?: VictoryRulesDto;
}
