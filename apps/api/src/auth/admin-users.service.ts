import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PlayerMediaGateway } from "../rooms/player-media.gateway";
import type { AccountIdentity } from "./session.service";
import type { ListUsersDto, UpdateUserDto } from "./admin-users.dto";
import { accountNickname, ensureNicknameAvailable, rejectNicknameConflict } from "./nickname";

const selection = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  createdAt: true,
  _count: { select: { participants: true } },
} as const;
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: PlayerMediaGateway,
  ) {}

  async list(query: ListUsersDto) {
    const page = query.page ?? 1;
    const search = query.search?.trim();
    const where: Prisma.UserAccountWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [users, total] = await this.prisma.$transaction([
      this.prisma.userAccount.findMany({
        where,
        select: selection,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      this.prisma.userAccount.count({ where }),
    ]);
    return {
      users: users.map(({ _count, ...user }) => ({ ...user, roomCount: _count.participants })),
      total,
      page,
      pageSize: 20,
    };
  }

  async update(actor: AccountIdentity, id: string, input: UpdateUserDto) {
    const nickname = accountNickname(input.displayName);
    let roleChanged = false;
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const currentActor = await tx.userAccount.findUnique({
            where: { id: actor.id },
            select: { role: true },
          });
          if (currentActor?.role !== "admin")
            throw new ForbiddenException("Раздел доступен администратору");
          if (id === actor.id && input.role !== "admin")
            throw new BadRequestException("Свою роль администратора нельзя изменить здесь");
          const target = await tx.userAccount.findUnique({ where: { id }, select: { role: true } });
          if (!target) throw new NotFoundException("Игрок не найден");
          if (target.role !== input.expectedRole)
            throw new ConflictException("Роль уже изменена. Обнови список игроков");
          await ensureNicknameAvailable(tx, nickname.nicknameKey, id);
          roleChanged = target.role !== input.role;
          const { _count, ...user } = await tx.userAccount.update({
            where: { id },
            data: { ...nickname, role: input.role },
            select: selection,
          });
          return { ...user, roomCount: _count.participants };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (roleChanged) await this.media.accountRoleChanged(id);
      return result;
    } catch (cause) {
      rejectNicknameConflict(cause);
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2034")
        throw new ConflictException(
          "Профили изменились одновременно. Обнови список и попробуй ещё раз",
        );
      throw cause;
    }
  }
}
