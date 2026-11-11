import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import type { TwentyOneCommand, TwentyOneSnapshot } from "@qwiza/minigames";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { TwentyOneService } from "./twenty-one.service";

export function parseTwentyOneCommand(input: unknown): TwentyOneCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type", "handVersion"]);
  const action = value.type === "hit" || value.type === "stand";
  if (
    !["ready", "hit", "stand", "rematch"].includes(String(value.type)) ||
    (action &&
      (typeof value.handVersion !== "number" ||
        !Number.isSafeInteger(value.handVersion) ||
        value.handVersion < 1)) ||
    (!action && value.handVersion !== undefined)
  )
    throw new Error("Неверная команда.");
  return value as unknown as TwentyOneCommand;
}
@WebSocketGateway({
  namespace: "/twenty-one",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class TwentyOneGateway extends MinigameGateway<TwentyOneCommand, TwentyOneSnapshot> {
  constructor(game: TwentyOneService) {
    super(game, parseTwentyOneCommand, "twenty-one");
  }
  @SubscribeMessage("twenty-one:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("twenty-one:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
}
