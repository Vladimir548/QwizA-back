import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import type { MemoryCommand, MemorySnapshot } from "@qwiza/minigames";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { MemoryService } from "./memory.service";

export function parseMemoryCommand(input: unknown): MemoryCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type", "index", "turn"]);
  if (
    !["ready", "flip", "rematch"].includes(String(value.type)) ||
    (value.type === "flip" &&
      (typeof value.index !== "number" ||
        !Number.isInteger(value.index) ||
        value.index < 0 ||
        value.index > 15 ||
        typeof value.turn !== "number" ||
        !Number.isSafeInteger(value.turn) ||
        value.turn < 0)) ||
    (value.type !== "flip" && (value.index !== undefined || value.turn !== undefined))
  )
    throw new Error("Неверная команда.");
  return value as unknown as MemoryCommand;
}

@WebSocketGateway({
  namespace: "/memory",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class MemoryGateway extends MinigameGateway<MemoryCommand, MemorySnapshot> {
  constructor(memory: MemoryService) {
    super(memory, parseMemoryCommand, "memory");
  }
  @SubscribeMessage("memory:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("memory:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
}
