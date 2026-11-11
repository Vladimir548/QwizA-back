import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import { isUUID } from "class-validator";
import type { FirefightCommand, FirefightInput, FirefightSnapshot } from "@qwiza/minigames";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { FirefightService } from "./firefight.service";

export function parseFirefightCommand(input: unknown): FirefightCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type"]);
  if (value.type !== "ready" && value.type !== "rematch") throw new Error("Неверная команда.");
  return value as unknown as FirefightCommand;
}
export function parseFirefightInput(input: unknown): FirefightInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !["roundId", "seq", "dx", "dy", "aimX", "aimY", "fire"].includes(key),
    ) ||
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
    Math.abs(value.dy) > 1 ||
    typeof value.aimX !== "number" ||
    !Number.isFinite(value.aimX) ||
    Math.abs(value.aimX) > 1 ||
    typeof value.aimY !== "number" ||
    !Number.isFinite(value.aimY) ||
    Math.abs(value.aimY) > 1 ||
    Math.hypot(value.aimX, value.aimY) < 0.01 ||
    typeof value.fire !== "boolean"
  )
    return null;
  return value as unknown as FirefightInput;
}
@WebSocketGateway({
  namespace: "/firefight",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class FirefightGateway extends MinigameGateway<FirefightCommand, FirefightSnapshot> {
  constructor(private readonly firefight: FirefightService) {
    super(firefight, parseFirefightCommand, "firefight");
  }
  @SubscribeMessage("firefight:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("firefight:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
  @SubscribeMessage("firefight:input")
  input(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    const parsed = parseFirefightInput(input);
    if (!parsed) return;
    const now = performance.now();
    const stopped = parsed.dx === 0 && parsed.dy === 0 && !parsed.fire;
    const stopTransition =
      stopped &&
      socket.data.firefightMoving === true &&
      socket.data.firefightRoundId === parsed.roundId &&
      parsed.seq > socket.data.firefightSeq &&
      now - (socket.data.lastFirefightStopAttempt ?? -Infinity) >= 20;
    if (now - (socket.data.lastFirefightInput ?? -Infinity) < 20 && !stopTransition) return;
    socket.data.lastFirefightInput = now;
    if (stopped) socket.data.lastFirefightStopAttempt = now;
    try {
      if (this.firefight.move(socket.data.roomId, socket.data.playerId, parsed)) {
        socket.data.firefightMoving = !stopped;
        socket.data.firefightRoundId = parsed.roundId;
        socket.data.firefightSeq = parsed.seq;
      }
    } catch {
      /* Expired rooms no longer accept movement input. */
    }
  }
}
