import { Body, Controller, Delete, Get, Param, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { SessionService, cookieToken } from "../auth/session.service";
import { PackRatingsService } from "./pack-ratings.service";
import { PackRatingDto } from "./dto/pack-rating.dto";

@Controller("workshop/ratings")
export class PackRatingsController {
  constructor(
    private readonly ratings: PackRatingsService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  list() {
    return this.ratings.list();
  }

  @Get(":id")
  async get(@Param("id") id: string, @Req() request: Request) {
    return this.ratings.get(id, await this.sessions.user(cookieToken(request)));
  }

  @Put(":id")
  async rate(@Param("id") id: string, @Body() dto: PackRatingDto, @Req() request: Request) {
    return this.ratings.rate(id, dto.value, await this.sessions.requireUser(request));
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @Req() request: Request) {
    return this.ratings.remove(id, await this.sessions.requireUser(request));
  }
}
