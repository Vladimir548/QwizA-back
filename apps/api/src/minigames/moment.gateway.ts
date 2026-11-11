import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import { isUUID } from "class-validator";
import type { Socket } from "socket.io";
import type { MomentCommand, MomentSnapshot } from "@qwiza/minigames";
import { MomentService } from "./moment.service";
import { MinigameGateway } from "./minigame-gateway";

export function parseMomentCommand(input: unknown): MomentCommand {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Неверная команда.");
  const value = input as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    !isUUID(value.id) ||
    typeof value.roundId !== "string" ||
    !isUUID(value.roundId) ||
    !["ready", "stop", "rematch"].includes(String(value.type)) ||
    Object.keys(value).some((key) => !["id", "roundId", "type", "elapsedMs"].includes(key)) ||
    (value.type === "stop" &&
      (typeof value.elapsedMs !== "number" || !Number.isFinite(value.elapsedMs))) ||
    (value.type !== "stop" && value.elapsedMs !== undefined)
  )
    throw new Error("Неверная команда.");
  return value as unknown as MomentCommand;
}

@WebSocketGateway({
  namespace: "/minigames",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class MomentGateway extends MinigameGateway<MomentCommand, MomentSnapshot> {
  constructor(moments: MomentService) {
    super(moments, parseMomentCommand, "moment");
  }
  @SubscribeMessage("moment:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("moment:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
}
