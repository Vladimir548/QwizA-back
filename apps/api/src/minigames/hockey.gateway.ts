import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import type { HockeyCommand, HockeyInput, HockeySnapshot } from "@qwiza/minigames";
import { isUUID } from "class-validator";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { HockeyService } from "./hockey.service";

export function parseHockeyCommand(input: unknown): HockeyCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type"]);
  if (value.type !== "ready" && value.type !== "rematch") throw new Error("Неверная команда.");
  return value as unknown as HockeyCommand;
}
export function parseHockeyInput(input: unknown): HockeyInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !["roundId", "sequence", "x", "y"].includes(key)) ||
    typeof value.roundId !== "string" ||
    !isUUID(value.roundId) ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    typeof value.x !== "number" ||
    !Number.isFinite(value.x) ||
    Math.abs(value.x) > 2000 ||
    typeof value.y !== "number" ||
    !Number.isFinite(value.y) ||
    Math.abs(value.y) > 2000
  )
    return null;
  return value as unknown as HockeyInput;
}
@WebSocketGateway({
  namespace: "/hockey",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class HockeyGateway extends MinigameGateway<HockeyCommand, HockeySnapshot> {
  constructor(private readonly hockey: HockeyService) {
    super(hockey, parseHockeyCommand, "hockey");
  }
  @SubscribeMessage("hockey:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("hockey:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
  @SubscribeMessage("hockey:input")
  input(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    const now = performance.now();
    if (now - (socket.data.lastHockeyInput ?? -Infinity) < 12) return;
    socket.data.lastHockeyInput = now;
    const parsed = parseHockeyInput(input);
    if (!parsed) return;
    try {
      this.hockey.input(socket.data.roomId, socket.data.playerId, parsed);
    } catch {
      /* A room can expire while its socket is still reconnecting. */
    }
  }
}
