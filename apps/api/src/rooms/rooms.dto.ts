import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";
import { VictorySettingsDto } from "./victory-rules.dto";

export class CreateRoomDto extends VictorySettingsDto {
  @IsString() @Length(1, 100) name!: string;
  @IsOptional() @IsUUID() packId?: string;
  @IsIn(["solo", "team"]) gameMode!: "solo" | "team";
  @IsOptional() @IsInt() @Min(2) @Max(4) teamCount?: number;
  @IsInt() @Min(2) @Max(12) maxPlayers!: number;
  @IsString() @Length(1, 40) displayName!: string;
  @IsOptional() @IsIn(["host", "player"]) requestedRole?: "host" | "player";
  @IsOptional() @IsBoolean() hostEnabled?: boolean;
  @IsOptional() @IsBoolean() hostRebuzzEnabled?: boolean;
  @IsOptional() @IsBoolean() powersEnabled?: boolean;
  @IsOptional() @IsBoolean() topicMinigamesEnabled?: boolean;
}

export class JoinRoomDto {
  @IsString() @Length(1, 40) displayName!: string;
  @IsOptional() @IsIn(["host", "player"]) requestedRole?: "host" | "player";
  @IsOptional() @IsInt() @Min(1) @Max(4) teamNumber?: number;
}
