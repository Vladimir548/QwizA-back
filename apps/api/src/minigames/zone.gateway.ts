import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import type { ZoneCommand, ZoneSnapshot } from "@qwiza/minigames";
import { isUUID } from "class-validator";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { ZoneService } from "./zone.service";

export function parseZoneCommand(input: unknown): ZoneCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type", "elapsedMs", "checkId"]);
  if (
    !["ready", "hit", "rematch"].includes(String(value.type)) ||
    (value.type === "hit" &&
      (typeof value.elapsedMs !== "number" ||
        !Number.isFinite(value.elapsedMs) ||
        value.elapsedMs < 0 ||
        value.elapsedMs > 2 * 60 * 60 * 1000 ||
        typeof value.checkId !== "string" ||
        !isUUID(value.checkId))) ||
    (value.type !== "hit" && (value.elapsedMs !== undefined || value.checkId !== undefined))
  )
    throw new Error("Неверная команда.");
  return value as unknown as ZoneCommand;
}
@WebSocketGateway({
  namespace: "/zone",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class ZoneGateway extends MinigameGateway<ZoneCommand, ZoneSnapshot> {
  constructor(zone: ZoneService) {
    super(zone, parseZoneCommand, "zone");
  }
  @SubscribeMessage("zone:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("zone:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
}
