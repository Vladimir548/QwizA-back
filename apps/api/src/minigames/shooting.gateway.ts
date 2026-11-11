import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import { isUUID } from "class-validator";
import type { ShootingCommand, ShootingCursorInput, ShootingSnapshot } from "@qwiza/minigames";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { ShootingService } from "./shooting.service";

const coordinate = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
export function parseShootingCommand(input: unknown): ShootingCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type", "targetId", "x", "y"]);
  if (value.type === "shoot") {
    if (
      !coordinate(value.x) ||
      !coordinate(value.y) ||
      (value.targetId !== undefined &&
        (typeof value.targetId !== "string" || !isUUID(value.targetId)))
    )
      throw new Error("Неверный выстрел.");
  } else if (
    (value.type !== "ready" && value.type !== "rematch") ||
    value.x !== undefined ||
    value.y !== undefined ||
    value.targetId !== undefined
  )
    throw new Error("Неверная команда.");
  return value as unknown as ShootingCommand;
}
export function parseShootingCursor(input: unknown): ShootingCursorInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !["seq", "x", "y"].includes(key)) ||
    !coordinate(value.x) ||
    !coordinate(value.y) ||
    typeof value.seq !== "number" ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0
  )
    return null;
  return value as unknown as ShootingCursorInput;
}

@WebSocketGateway({
  namespace: "/shooting",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class ShootingGateway extends MinigameGateway<ShootingCommand, ShootingSnapshot> {
  constructor(private readonly shooting: ShootingService) {
    super(shooting, parseShootingCommand, "shooting");
  }
  @SubscribeMessage("shooting:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("shooting:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
  @SubscribeMessage("shooting:cursor")
  cursor(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    const now = performance.now();
    if (now - (socket.data.lastShootingCursor ?? -Infinity) < 40) return;
    socket.data.lastShootingCursor = now;
    const parsed = parseShootingCursor(input);
    if (!parsed) return;
    try {
      this.shooting.moveCursor(socket.data.roomId, socket.data.playerId, parsed);
    } catch {
      /* An expired room no longer needs cursor updates. */
    }
  }
}
