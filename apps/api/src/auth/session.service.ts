import { ForbiddenException, Injectable, Module, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";

export type AccountIdentity = {
  id: string;
  email: string | null;
  displayName: string;
  role: string;
};
export function publicUser(user: AccountIdentity) {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}
export function cookieToken(request: Pick<Request, "headers">) {
  const value = request.headers.cookie
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("qwesto_session="))
    ?.slice("qwesto_session=".length);
  return value && /^[A-Za-z0-9_-]{40,100}$/.test(value) ? value : undefined;
}
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  async user(token?: string) {
    if (!token || token.length > 200) return null;
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: createHash("sha256").update(token).digest("hex") },
      include: { user: true },
    });
    return session && session.expiresAt.getTime() > Date.now() ? publicUser(session.user) : null;
  }
  async requireUser(request: Request) {
    const origin = request.headers.origin;
    if (
      origin &&
      ![
        this.config.getOrThrow<string>("WEB_ORIGIN"),
        "http://localhost:3000",
        "http://127.0.0.1:3000",
      ].includes(origin)
    )
      throw new ForbiddenException("Недопустимый источник запроса");
    const user = await this.user(cookieToken(request));
    if (!user) throw new UnauthorizedException("Войди в аккаунт, чтобы работать со своими паками");
    return user;
  }
  async requireAdmin(request: Request) {
    const user = await this.requireUser(request);
    if (user.role !== "admin") throw new ForbiddenException("Раздел доступен администратору");
    return user;
  }
}
@Module({ providers: [SessionService], exports: [SessionService] })
export class SessionModule {}
