import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import type { Request } from "express";
import { PrismaService } from "../src/prisma/prisma.service";
import { SessionService } from "../src/auth/session.service";
import { AuthService } from "../src/auth/auth.service";
import { AdminUsersService } from "../src/auth/admin-users.service";
import { AdminUsersController } from "../src/auth/admin-users.controller";
import { ListUsersDto, UpdateUserDto } from "../src/auth/admin-users.dto";
import { RoomsService } from "../src/rooms/rooms.service";
import { PlayerMediaGateway } from "../src/rooms/player-media.gateway";
import { PacksRepository } from "../src/workshop/packs.repository";

test("administrator manages names and roles without exposing credentials or losing the last administrator", async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL required");
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: url }));
  await prisma.$connect();
  const rooms = new RoomsService(prisma, new PacksRepository(prisma));
  const sessions = new SessionService(
    prisma,
    new ConfigService({ WEB_ORIGIN: "http://localhost:3000" }),
  );
  const auth = new AuthService(prisma, rooms, sessions);
  const revoked: string[] = [];
  const service = new AdminUsersService(prisma, {
    accountRoleChanged: (id: string) => revoked.push(id),
  } as unknown as PlayerMediaGateway);
  const controller = new AdminUsersController(sessions, service);
  const accounts: string[] = [];
  const request = (token?: string, origin = "http://localhost:3000") =>
    ({ headers: { origin, cookie: token ? `qwesto_session=${token}` : "" } }) as Request;
  const prefix = `roles-${randomUUID()}`;
  try {
    const create = async (role: string) => {
      const password = randomUUID();
      const account = await auth.register({
        password,
        nickname: `${prefix.slice(0, 30)}-${role}`,
      });
      accounts.push(account.user.id);
      await prisma.userAccount.update({ where: { id: account.user.id }, data: { role } });
      return { ...account, password };
    };
    const admin = await create("admin"),
      regular = await create("user"),
      media = await create("media");
    for (const req of [
      request(),
      request(regular.token),
      request(media.token),
      request(admin.token, "https://other.example"),
    ])
      await assert.rejects(controller.list(req, {}));
    const query = { search: prefix.slice(0, 30), page: 1 };
    const list = await controller.list(request(admin.token), query);
    assert.equal(list.total, 3);
    assert.ok(
      list.users.every(
        (user) => !Object.hasOwn(user, "passwordHash") && !Object.hasOwn(user, "sessions"),
      ),
    );
    assert.equal(
      (await controller.list(request(admin.token), { ...query, role: "media" })).total,
      1,
    );
    const changed = await controller.update(request(admin.token), regular.user.id, {
      displayName: "Новое имя",
      role: "media",
      expectedRole: "user",
    });
    assert.equal(changed.displayName, "Новое имя");
    assert.equal(changed.role, "media");
    assert.equal((await auth.user(regular.token))?.role, "media");
    assert.deepEqual(revoked, [regular.user.id]);
    assert.equal(
      (await auth.login({ nickname: "НОВОЕ ИМЯ", password: regular.password })).user.id,
      regular.user.id,
    );
    await assert.rejects(
      controller.update(request(admin.token), media.user.id, {
        displayName: "новое имя",
        role: "media",
        expectedRole: "media",
      }),
      /ник уже занят/,
    );
    await assert.rejects(
      controller.update(request(admin.token), regular.user.id, {
        displayName: "Stale",
        role: "admin",
        expectedRole: "user",
      }),
      /уже изменена/,
    );
    await assert.rejects(
      controller.update(request(regular.token), admin.user.id, {
        displayName: "Denied",
        role: "media",
        expectedRole: "admin",
      }),
      /администратору/,
    );
    await assert.rejects(
      controller.update(request(admin.token), admin.user.id, {
        displayName: "Self",
        role: "media",
        expectedRole: "admin",
      }),
      /Свою роль/,
    );
    await assert.rejects(
      controller.update(request(admin.token), media.user.id, {
        displayName: "  ",
        role: "media",
        expectedRole: "media",
      }),
      /пустым/,
    );
    await controller.update(request(admin.token), media.user.id, {
      displayName: "Другой админ",
      role: "admin",
      expectedRole: "media",
    });
    // Two administrators cannot race to remove each other's access and leave none.
    await Promise.allSettled([
      controller.update(request(admin.token), media.user.id, {
        displayName: "Media",
        role: "media",
        expectedRole: "admin",
      }),
      controller.update(request(media.token), admin.user.id, {
        displayName: "Admin",
        role: "media",
        expectedRole: "admin",
      }),
    ]);
    assert.ok(await prisma.userAccount.count({ where: { id: { in: accounts }, role: "admin" } }));
    for (const input of [
      { role: "root", expectedRole: "user", displayName: "Name" },
      { role: "admin", expectedRole: "user", displayName: "x".repeat(41) },
    ])
      assert.ok((await validate(plainToInstance(UpdateUserDto, input))).length);
    for (const input of [{ page: -1 }, { role: "root" }, { search: "x".repeat(101) }])
      assert.ok((await validate(plainToInstance(ListUsersDto, input))).length);
  } finally {
    await prisma.userAccount.deleteMany({ where: { id: { in: accounts } } });
    await prisma.$disconnect();
  }
});
