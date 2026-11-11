import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { PackDto } from "./dto/pack.dto";
import { MediaService } from "./media.service";
import { PacksService } from "./packs.service";
import { SessionService, cookieToken } from "../auth/session.service";
import { PackWorkflowService } from "./pack-workflow.service";
import { PackReviewDto, PackPublicationDto } from "./dto/pack-review.dto";

@Controller("workshop")
export class WorkshopController {
  constructor(
    private readonly packs: PacksService,
    private readonly media: MediaService,
    private readonly sessions: SessionService,
    private readonly workflow: PackWorkflowService,
  ) {}

  @Get("config")
  config() {
    return this.media.limits();
  }

  @Post("media/images")
  @UseInterceptors(FileInterceptor("file"))
  uploadImage(@UploadedFile() file?: Express.Multer.File) {
    return this.media.uploadImage(file);
  }

  @Post("media/videos")
  @UseInterceptors(FileInterceptor("file"))
  uploadVideo(@UploadedFile() file?: Express.Multer.File) {
    return this.media.uploadVideo(file);
  }

  @Post("media/audio")
  @UseInterceptors(FileInterceptor("file"))
  uploadAudio(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("start") start: string,
    @Body("end") end: string,
  ) {
    return this.media.uploadAudio(file, Number(start), Number(end));
  }

  @Get("media/:kind/:id")
  async mediaFile(
    @Param("kind") kind: string,
    @Param("id") id: string,
    @Headers("range") range: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.media.get(kind, id, range);
    response.status(result.status);
    for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
    return result.file;
  }

  @Get("packs")
  async list(@Req() request: Request) {
    return this.workflow.list(await this.sessions.requireUser(request));
  }

  @Get("store")
  store() {
    return this.packs.store();
  }

  @Get("library")
  async library(@Req() request: Request) {
    return this.workflow.library(await this.sessions.user(cookieToken(request)));
  }

  @Get("packs/:id")
  async get(@Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.workflow.get(id, await this.sessions.user(cookieToken(request)));
  }

  @Post("packs")
  async create(@Body() dto: PackDto, @Req() request: Request) {
    return this.workflow.create(dto, await this.sessions.requireUser(request));
  }

  @Put("packs/:id")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: PackDto,
    @Req() request: Request,
  ) {
    return this.workflow.update(id, dto, await this.sessions.requireUser(request));
  }

  @Delete("packs/:id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.workflow.remove(id, await this.sessions.requireUser(request));
  }

  @Put("packs/:id/publication")
  async setPublished(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: PackPublicationDto,
    @Req() request: Request,
  ) {
    if (typeof body.published !== "boolean")
      throw new BadRequestException("Укажи состояние публикации");
    return this.workflow.publication(id, body.published, await this.sessions.requireUser(request));
  }

  @Post("check")
  async check(@Body() dto: PackDto, @Req() request: Request) {
    await this.sessions.requireUser(request);
    return this.packs.check(dto);
  }

  @Get("moderation")
  async queue(@Req() request: Request) {
    return this.workflow.queue(await this.sessions.requireUser(request));
  }

  @Post("packs/:id/review")
  async review(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: PackReviewDto,
    @Req() request: Request,
  ) {
    return this.workflow.review(id, await this.sessions.requireUser(request), dto);
  }
}
