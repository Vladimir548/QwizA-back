import { IsEmail, IsOptional, IsString, IsUUID, Length, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail() @Length(3, 254) email!: string;
  @IsString() @MinLength(12) @Length(12, 128) password!: string;
  @IsOptional() @IsString() @Length(1, 40) displayName?: string;
}

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}

export class ClaimRoomDto {
  @IsUUID() roomId!: string;
  @IsString() token!: string;
}

export class RejoinRoomDto {
  @IsUUID() roomId!: string;
}
