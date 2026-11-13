import { Transform } from "class-transformer";
import { IsString, IsUUID, Length, MinLength } from "class-validator";

export class RegisterDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(3, 40, { message: "Ник должен содержать от 3 до 40 символов" })
  nickname!: string;
  @IsString() @MinLength(12) @Length(12, 128) password!: string;
}

export class LoginDto {
  @IsString() @Length(1, 254) nickname!: string;
  @IsString() password!: string;
}

export class ClaimRoomDto {
  @IsUUID() roomId!: string;
  @IsString() token!: string;
}

export class RejoinRoomDto {
  @IsUUID() roomId!: string;
}
