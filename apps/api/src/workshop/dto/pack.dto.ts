import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsNumber,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class MediaRefDto {
  @IsUUID()
  id!: string;

  @IsIn(["image", "video", "audio"])
  kind!: "image" | "video" | "audio";

  @IsOptional() @IsNumber() @Min(1) @Max(7200) durationSeconds?: number;
}

export class GeoPointDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class ImagePointDto {
  @IsNumber() @Min(0) @Max(1) x!: number;
  @IsNumber() @Min(0) @Max(1) y!: number;
}

export class ComparisonOptionDto {
  @IsUUID() id!: string;
  @IsString() @MaxLength(200) label!: string;
  @IsNumber() @Min(0) @Max(1000000000) amount!: number;
  @IsOptional() @ValidateNested() @Type(() => MediaRefDto) media?: MediaRefDto;
}

export class MatchingPairDto {
  @IsString() @MaxLength(200) element!: string;
  @IsString() @MaxLength(120) fact!: string;
  @IsOptional() @ValidateNested() @Type(() => MediaRefDto) media?: MediaRefDto;
}

export class QuestionDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsIn([
    "text",
    "choice",
    "geo",
    "image-point",
    "comparison",
    "numeric-closest",
    "puzzle",
    "spot-difference",
    "matching",
    "video-prediction",
  ])
  type!:
    | "text"
    | "choice"
    | "geo"
    | "image-point"
    | "comparison"
    | "numeric-closest"
    | "puzzle"
    | "spot-difference"
    | "matching"
    | "video-prediction";

  @IsOptional()
  @IsIn(["buzzer", "everyone"])
  answerMode?: "buzzer" | "everyone";

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(60)
  answerTimeSeconds?: number;

  @IsInt()
  @Min(1)
  @Max(100000)
  value!: number;

  @IsString()
  @MaxLength(1000)
  promptText!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaRefDto)
  questionMedia?: MediaRefDto;

  @IsString()
  @MaxLength(300)
  answerText!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  acceptedAnswers?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaRefDto)
  answerMedia?: MediaRefDto;

  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  choices!: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  correctChoiceIndex!: number | null;

  @IsOptional() @IsIn(["world", "image"]) geoMapMode?: "world" | "image";
  @IsOptional() @ValidateNested() @Type(() => MediaRefDto) geoMapMedia?: MediaRefDto;

  @IsOptional() @ValidateNested() @Type(() => GeoPointDto) geoTarget?: GeoPointDto;
  @IsOptional() @IsNumber() @Min(0.1) @Max(20000) geoToleranceKm?: number;
  @IsOptional() @ValidateNested() @Type(() => ImagePointDto) imageTarget?: ImagePointDto;
  @IsOptional() @IsNumber() @Min(0.5) @Max(30) imageTolerancePercent?: number;
  @IsOptional() @IsString() @MaxLength(30) comparisonUnit?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ComparisonOptionDto)
  comparisonOptions?: ComparisonOptionDto[];

  @IsOptional() @IsNumber() @Min(-1000000000) @Max(1000000000) numericTarget?: number;
  @IsOptional() @IsString() @MaxLength(30) numericUnit?: string;
  @IsOptional() @IsInt() @Min(2) @Max(5) puzzleGridSize?: number;
  @IsOptional() @ValidateNested() @Type(() => MediaRefDto) differenceMedia?: MediaRefDto;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ImagePointDto)
  differenceTargets?: ImagePointDto[];
  @IsOptional() @IsNumber() @Min(1) @Max(15) differenceTolerancePercent?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => MatchingPairDto)
  matchingPairs?: MatchingPairDto[];
  @IsOptional() @IsNumber() @Min(0.5) videoStopSeconds?: number;
}

export class TopicDto {
  @IsOptional() @IsBoolean() isFinal?: boolean;
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  roundIndex?: number;

  @IsString()
  @MaxLength(100)
  title!: string;

  @IsBoolean()
  ordered!: boolean;

  @IsIn(["forward", "reverse"])
  direction!: "forward" | "reverse";

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions!: QuestionDto[];
}

export class PackDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => MediaRefDto)
  cover?: MediaRefDto;
  @IsString()
  @MaxLength(100)
  title!: string;

  @IsString()
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  rounds?: string[];

  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => TopicDto)
  topics!: TopicDto[];
}
