import { ForbiddenException } from "@nestjs/common";
import type { AccountIdentity } from "../auth/session.service";

export function requireTeamModeAccess(mode: string, user: Pick<AccountIdentity, "role"> | null) {
  if (mode === "team" && user?.role !== "admin")
    throw new ForbiddenException("Командная игра в разработке. Пока доступна только разработчику.");
}
