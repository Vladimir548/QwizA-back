import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";

export function accountNickname(value: string, minimum = 1) {
  const displayName = value.trim();
  if (!displayName) throw new BadRequestException("Ник не может быть пустым");
  if (displayName.length < minimum || displayName.length > 40 || /\p{C}/u.test(displayName))
    throw new BadRequestException(
      `Ник должен содержать от ${minimum} до 40 символов без управляющих знаков`,
    );
  return { displayName, nicknameKey: displayName.toLowerCase() };
}

export function rejectNicknameConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    throw new ConflictException("Этот ник уже занят. Выбери другой");
}

export async function ensureNicknameAvailable(
  database: Pick<Prisma.TransactionClient, "userAccount">,
  nicknameKey: string,
  exceptId?: string,
) {
  const exists = await database.userAccount.findFirst({
    where: {
      ...(exceptId ? { id: { not: exceptId } } : {}),
      OR: [{ nicknameKey }, ...(nicknameKey.includes("@") ? [{ email: nicknameKey }] : [])],
    },
    select: { id: true },
  });
  // A new nickname must not shadow an older account's email login either.
  if (exists) throw new ConflictException("Этот ник уже занят. Выбери другой");
}
