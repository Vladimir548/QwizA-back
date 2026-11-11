import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import { isUUID } from "class-validator";
import type { RockfallCommand, RockfallInput, RockfallSnapshot } from "@qwiza/minigames";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { RockfallService } from "./rockfall.service";

export function parseRockfallCommand(input: unknown): RockfallCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type"]);
  if (value.type !== "ready" && value.type !== "rematch") throw new Error("Неверная команда.");
  return value as unknown as RockfallCommand;
}
export function parseRockfallInput(input: unknown): RockfallInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !["roundId", "seq", "dx", "jumpSeq"].includes(key)) ||
    typeof value.roundId !== "string" ||
    !isUUID(value.roundId) ||
    typeof value.seq !== "number" ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0 ||
    typeof value.dx !== "number" ||
    !Number.isFinite(value.dx) ||
    Math.abs(value.dx) > 1 ||
    typeof value.jumpSeq !== "number" ||
    !Number.isSafeInteger(value.jumpSeq) ||
    value.jumpSeq < 0
  )
    return null;
  return value as unknown as RockfallInput;
}
@WebSocketGateway({
  namespace: "/rockfall",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class RockfallGateway extends MinigameGateway<RockfallCommand, RockfallSnapshot> {
  constructor(private readonly rockfall: RockfallService) {
    super(rockfall, parseRockfallCommand, "rockfall");
  }
  @SubscribeMessage("rockfall:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("rockfall:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
  @SubscribeMessage("rockfall:input")
  input(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    const parsed = parseRockfallInput(input);
    if (!parsed) return;
    const now = performance.now();
    const stopped = parsed.dx === 0;
    const stopTransition =
      stopped &&
      socket.data.rockfallMoving === true &&
      socket.data.rockfallRoundId === parsed.roundId &&
      parsed.seq > socket.data.rockfallSeq &&
      now - (socket.data.lastRockfallStopAttempt ?? -Infinity) >= 20;
    if (now - (socket.data.lastRockfallInput ?? -Infinity) < 20 && !stopTransition) return;
    socket.data.lastRockfallInput = now;
    if (stopped) socket.data.lastRockfallStopAttempt = now;
    try {
      if (this.rockfall.move(socket.data.roomId, socket.data.playerId, parsed)) {
        socket.data.rockfallMoving = !stopped;
        socket.data.rockfallRoundId = parsed.roundId;
        socket.data.rockfallSeq = parsed.seq;
      }
    } catch {
      /* Expired rooms no longer accept movement input. */
    }
  }
}
