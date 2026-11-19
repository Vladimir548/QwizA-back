import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
import {
  PACK_MODERATION_FILTERS,
  PACK_SORTS,
  type PackCatalogSort,
  type PackModerationFilter,
} from "@qwiza/minigames";

export class PackCatalogQueryDto {
  @IsOptional() @IsIn(PACK_SORTS) sort?: PackCatalogSort;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === "true" ? true : value === "false" ? false : value,
  )
  @IsBoolean()
  official?: boolean;
}
export class PackModerationQueryDto {
  @IsOptional()
  @IsIn(PACK_MODERATION_FILTERS)
  status?: PackModerationFilter;
}
export class PackDeleteQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) revision?: number;
}
