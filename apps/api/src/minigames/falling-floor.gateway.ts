import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import { isUUID } from "class-validator";
import type {
  FallingFloorCommand,
  FallingFloorInput,
  FallingFloorSnapshot,
} from "@qwiza/minigames";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { FallingFloorService } from "./falling-floor.service";

export function parseFallingFloorCommand(input: unknown): FallingFloorCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type"]);
  if (value.type !== "ready" && value.type !== "rematch") throw new Error("Неверная команда.");
  return value as unknown as FallingFloorCommand;
}
export function parseFallingFloorInput(input: unknown): FallingFloorInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !["roundId", "seq", "dx", "dy"].includes(key)) ||
    typeof value.roundId !== "string" ||
    !isUUID(value.roundId) ||
    typeof value.seq !== "number" ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0 ||
    typeof value.dx !== "number" ||
    !Number.isFinite(value.dx) ||
    Math.abs(value.dx) > 1 ||
    typeof value.dy !== "number" ||
    !Number.isFinite(value.dy) ||
    Math.abs(value.dy) > 1
  )
    return null;
  return value as unknown as FallingFloorInput;
}
@WebSocketGateway({
  namespace: "/falling-floor",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class FallingFloorGateway extends MinigameGateway<
  FallingFloorCommand,
  FallingFloorSnapshot
> {
  constructor(private readonly fallingFloor: FallingFloorService) {
    super(fallingFloor, parseFallingFloorCommand, "falling-floor");
  }
  @SubscribeMessage("falling-floor:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("falling-floor:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
  @SubscribeMessage("falling-floor:input")
  input(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    const parsed = parseFallingFloorInput(input);
    if (!parsed) return;
    const now = performance.now();
    const stopped = parsed.dx === 0 && parsed.dy === 0;
    const stopTransition =
      stopped &&
      socket.data.fallingFloorMoving === true &&
      socket.data.fallingFloorRoundId === parsed.roundId &&
      parsed.seq > socket.data.fallingFloorSeq &&
      now - (socket.data.lastFallingFloorStopAttempt ?? -Infinity) >= 20;
    if (now - (socket.data.lastFallingFloorInput ?? -Infinity) < 20 && !stopTransition) return;
    socket.data.lastFallingFloorInput = now;
    if (stopped) socket.data.lastFallingFloorStopAttempt = now;
    try {
      if (this.fallingFloor.move(socket.data.roomId, socket.data.playerId, parsed)) {
        socket.data.fallingFloorMoving = !stopped;
        socket.data.fallingFloorRoundId = parsed.roundId;
        socket.data.fallingFloorSeq = parsed.seq;
      }
    } catch {
      /* Expired rooms no longer accept movement input. */
    }
  }
}
