import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import type { BluffCommand, BluffSnapshot } from "@qwiza/minigames";
import { BLUFF_ROUNDS, BLUFF_TOKENS } from "@qwiza/minigames";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { DoubleBluffService } from "./double-bluff.service";

export function parseBluffCommand(input: unknown): BluffCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type", "auction", "amount"]);
  const bid = value.type === "bid";
  if (
    !["ready", "bid", "rematch"].includes(String(value.type)) ||
    (bid &&
      (typeof value.auction !== "number" ||
        !Number.isSafeInteger(value.auction) ||
        value.auction < 1 ||
        value.auction > BLUFF_ROUNDS ||
        typeof value.amount !== "number" ||
        !Number.isSafeInteger(value.amount) ||
        value.amount < 0 ||
        value.amount > BLUFF_TOKENS)) ||
    (!bid && (value.auction !== undefined || value.amount !== undefined))
  )
    throw new Error("Неверная команда.");
  return value as unknown as BluffCommand;
}
@WebSocketGateway({
  namespace: "/double-bluff",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class DoubleBluffGateway extends MinigameGateway<BluffCommand, BluffSnapshot> {
  constructor(game: DoubleBluffService) {
    super(game, parseBluffCommand, "double-bluff");
  }
  @SubscribeMessage("double-bluff:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("double-bluff:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
}
