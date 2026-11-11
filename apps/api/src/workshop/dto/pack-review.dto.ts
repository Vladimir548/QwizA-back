import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
export class PackPublicationDto {
  @IsBoolean() published!: boolean;
}
export class PackReviewDto {
  @IsInt() @Min(1) revision!: number;
  @IsIn(["approve", "reject"]) decision!: "approve" | "reject";
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
