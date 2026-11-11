import { Body, Controller, ForbiddenException, Get, Headers, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { cookieToken } from "./session.service";
import { AuthService } from "./auth.service";
import { ClaimRoomDto, LoginDto, RegisterDto, RejoinRoomDto } from "./auth.dto";

const COOKIE = "qwesto_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private assertOrigin(origin?: string) {
    if (
      origin &&
      ![
        this.config.getOrThrow<string>("WEB_ORIGIN"),
        "http://localhost:3000",
        "http://127.0.0.1:3000",
      ].includes(origin)
    )
      throw new ForbiddenException("Недопустимый источник запроса");
  }

  private setSession(response: Response, token: string) {
    response.cookie(COOKIE, token, {
      httpOnly: true,
      secure: this.config.getOrThrow<string>("WEB_ORIGIN").startsWith("https://"),
      sameSite: "lax",
      maxAge: SESSION_SECONDS * 1000,
      path: "/",
    });
  }

  @Post("register")
  async register(
    @Body() body: RegisterDto,
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertOrigin(origin);
    const { user, token } = await this.auth.register(body);
    this.setSession(response, token);
    return user;
  }

  @Post("login")
  async login(
    @Body() body: LoginDto,
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertOrigin(origin);
    const { user, token } = await this.auth.login(body);
    this.setSession(response, token);
    return user;
  }

  @Get("me")
  async me(@Req() request: Request) {
    return { user: await this.auth.user(cookieToken(request)) };
  }

  @Post("logout")
  async logout(
    @Req() request: Request,
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertOrigin(origin);
    const result = await this.auth.logout(cookieToken(request));
    response.clearCookie(COOKIE, { path: "/" });
    return result;
  }

  @Post("claim-room")
  claimRoom(
    @Req() request: Request,
    @Headers("origin") origin: string | undefined,
    @Body() body: ClaimRoomDto,
  ) {
    this.assertOrigin(origin);
    return this.auth.claimRoom(cookieToken(request), body.roomId, body.token);
  }

  @Post("rejoin-room")
  rejoinRoom(
    @Req() request: Request,
    @Headers("origin") origin: string | undefined,
    @Body() body: RejoinRoomDto,
  ) {
    this.assertOrigin(origin);
    return this.auth.rejoinRoom(cookieToken(request), body.roomId);
  }

  @Get("rooms")
  rooms(@Req() request: Request) {
    return this.auth.roomsForUser(cookieToken(request));
  }
}
