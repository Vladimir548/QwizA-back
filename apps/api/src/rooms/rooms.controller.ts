import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  NotFoundException,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionService, cookieToken } from "../auth/session.service";
import { PacksRepository } from "../workshop/packs.repository";
import { canViewPack } from "../workshop/pack-access";
import { CreateRoomDto, JoinRoomDto } from "./rooms.dto";
import { RoomsService } from "./rooms.service";

@Controller("rooms")
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly sessions: SessionService,
    private readonly packs: PacksRepository,
  ) {}

  @Post()
  async create(@Body() input: CreateRoomDto, @Req() request: Request) {
    if (input.packId) {
      const [pack, user] = await Promise.all([
        this.packs.find(input.packId),
        this.sessions.user(cookieToken(request)),
      ]);
      if (!pack || !canViewPack(pack, user))
        throw new NotFoundException("Пак не опубликован или недоступен");
    }
    return this.rooms.create(input);
  }

  @Post(":roomId/join")
  join(@Param("roomId", ParseUUIDPipe) roomId: string, @Body() input: JoinRoomDto) {
    return this.rooms.join(roomId, input);
  }

  @Get("by-code/:code")
  resolveCode(@Param("code") code: string) {
    return this.rooms.resolveCode(code);
  }

  @Get(":roomId/preview")
  preview(@Param("roomId", ParseUUIDPipe) roomId: string) {
    return this.rooms.preview(roomId);
  }

  @Get(":roomId")
  snapshot(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Headers("authorization") authorization?: string,
  ) {
    const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
    return this.rooms.snapshot(roomId, token);
  }

  @Get(":roomId/host-answer")
  hostAnswer(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Headers("authorization") authorization?: string,
  ) {
    const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
    return this.rooms.hostAnswer(roomId, token);
  }

  @Get(":roomId/duel-minigame")
  duelMinigame(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Headers("authorization") authorization?: string,
  ) {
    return this.rooms.duelMinigame(roomId, authorization?.match(/^Bearer (.+)$/i)?.[1]);
  }

  @Get(":roomId/topic-minigame")
  topicMinigame(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Headers("authorization") authorization?: string,
  ) {
    return this.rooms.topicMinigame(roomId, authorization?.match(/^Bearer (.+)$/i)?.[1]);
  }
}
