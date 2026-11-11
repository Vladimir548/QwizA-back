import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "./session.service";
import { AdminUsersService } from "./admin-users.service";
import { ListUsersDto, UpdateUserDto } from "./admin-users.dto";

@Controller("admin/users")
export class AdminUsersController {
  constructor(
    private readonly sessions: SessionService,
    private readonly users: AdminUsersService,
  ) {}
  @Get()
  async list(@Req() request: Request, @Query() query: ListUsersDto) {
    await this.sessions.requireAdmin(request);
    return this.users.list(query);
  }
  @Patch(":id")
  async update(
    @Req() request: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: UpdateUserDto,
  ) {
    return this.users.update(await this.sessions.requireAdmin(request), id, input);
  }
}
