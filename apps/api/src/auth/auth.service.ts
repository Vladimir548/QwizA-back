import { publicUser, SessionService } from "./session.service";
import { requireTeamModeAccess } from "../rooms/team-mode-access";
import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RoomsService } from "../rooms/rooms.service";
import type { LoginDto, RegisterDto } from "./auth.dto";
import { isRoomComplete, roomResultSummary } from "../rooms/room-statistics";
import type { PrivateRoomState, RoomPack } from "../rooms/rooms.types";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly sessions: SessionService,
  ) {}

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    const exists = await this.prisma.userAccount.findUnique({
      where: { email },
      select: { id: true },
    });
    if (exists) throw new ConflictException("Этот адрес уже зарегистрирован");
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const user = await this.prisma.userAccount.create({
      data: {
        id: randomUUID(),
        email,
        passwordHash,
        displayName: input.displayName?.trim() || email.split("@")[0].slice(0, 40),
      },
    });
    const token = await this.startSession(user.id);
    return { user: publicUser(user), token };
  }

  async login(input: LoginDto) {
    const user = await this.prisma.userAccount.findUnique({
      where: { email: input.email.trim().toLowerCase() },
    });
    if (!user || !(await argon2.verify(user.passwordHash, input.password)))
      throw new UnauthorizedException("Неверная почта или пароль");
    const token = await this.startSession(user.id);
    return { user: publicUser(user), token };
  }

  private async startSession(userId: string) {
    const token = randomBytes(32).toString("base64url");
    await this.prisma.authSession.create({
      data: {
        id: randomUUID(),
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SESSION_MS),
      },
    });
    return token;
  }

  async user(token?: string) {
    return this.sessions.user(token);
  }

  async requireUser(token?: string) {
    const user = await this.user(token);
    if (!user) throw new UnauthorizedException("Войди в аккаунт");
    return user;
  }

  async logout(token?: string) {
    if (token) await this.prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
    return { ok: true };
  }

  async claimRoom(userToken: string | undefined, roomId: string, participantToken: string) {
    const user = await this.requireUser(userToken);
    const participant = await this.rooms.authenticate(roomId, participantToken);
    if (participant.userId && participant.userId !== user.id)
      throw new ConflictException("Место уже связано с другим аккаунтом");
    const claimedSeat = await this.prisma.gameParticipant.findFirst({
      where: { roomId, userId: user.id, id: { not: participant.id } },
      select: { id: true },
    });
    if (claimedSeat) throw new ConflictException("У аккаунта уже есть место в этой комнате");
    try {
      await this.prisma.gameParticipant.update({
        where: { id: participant.id },
        data: { userId: user.id },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new ConflictException("У аккаунта уже есть место в этой комнате");
      throw error;
    }
    return { ok: true, participantId: participant.id };
  }

  async rejoinRoom(userToken: string | undefined, roomId: string) {
    const user = await this.requireUser(userToken);
    const participant = await this.prisma.gameParticipant.findFirst({
      where: { roomId, userId: user.id },
      orderBy: { joinedAt: "asc" },
      include: { room: { select: { gameMode: true } } },
    });
    if (!participant) throw new UnauthorizedException("У тебя нет места в этой комнате");
    requireTeamModeAccess(participant.room.gameMode, user);
    const token = randomBytes(32).toString("base64url");
    await this.prisma.gameParticipant.update({
      where: { id: participant.id },
      data: { tokenHash: hashToken(token) },
    });
    return {
      roomId,
      participantId: participant.id,
      token,
      snapshot: await this.rooms.publicSnapshot(roomId),
    };
  }

  async roomsForUser(userToken?: string) {
    const user = await this.requireUser(userToken);
    const seats = await this.prisma.gameParticipant.findMany({
      where: { userId: user.id },
      include: {
        room: {
          select: {
            id: true,
            code: true,
            name: true,
            updatedAt: true,
            packId: true,
            pack: true,
            state: true,
            gameMode: true,
            teamCount: true,
            participants: {
              select: { id: true, name: true, role: true, score: true, teamId: true },
            },
          },
        },
      },
      orderBy: { room: { updatedAt: "desc" } },
    });
    return seats.map((seat) => {
      const room = seat.room;
      const state = room.state as unknown as PrivateRoomState;
      const pack = room.pack as unknown as RoomPack;
      const completed = isRoomComplete(pack, state);
      const teams = room.gameMode === "team";
      const summary = completed
        ? roomResultSummary(room.participants, teams, room.teamCount, state)
        : undefined;
      const resultId = teams ? seat.teamId : seat.id;
      const result =
        seat.role === "player"
          ? summary?.standings.find((entry) => entry.id === resultId)
          : undefined;
      return {
        roomId: room.id,
        code: room.code,
        name: room.name,
        updatedAt: room.updatedAt.toISOString(),
        packId: room.packId ?? pack.id,
        packTitle: pack.title,
        role: seat.role as "player" | "host",
        gameMode: room.gameMode as "solo" | "team",
        completed,
        status: completed ? "completed" : state.phase === "lobby" ? "lobby" : "playing",
        place: result?.place ?? null,
        score: result?.score ?? null,
        teamName: teams ? (state.teamNames?.[seat.teamId ?? ""] ?? result?.name ?? null) : null,
        playerCount: room.participants.filter((person) => person.role === "player").length,
        competitorCount: summary?.standings.length ?? null,
        victoryMode: state.victory?.mode ?? "score",
      };
    });
  }
}
