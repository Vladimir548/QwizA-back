import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { ACCOUNT_ROLES, type AccountRole } from "@qwiza/minigames";

export class ListUsersDto {
  @IsOptional() @IsString() @Length(0, 100) search?: string;
  @IsOptional() @IsIn(ACCOUNT_ROLES) role?: AccountRole;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
}
export class UpdateUserDto {
  @IsString() @Length(1, 40) displayName!: string;
  @IsIn(ACCOUNT_ROLES) role!: AccountRole;
  @IsIn(ACCOUNT_ROLES) expectedRole!: AccountRole;
}
