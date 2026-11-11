import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import type { NumberHuntCommand, NumberHuntSnapshot } from "@qwiza/minigames";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { NumberHuntService } from "./number-hunt.service";

export function parseNumberHuntCommand(input: unknown): NumberHuntCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type", "index", "turn"]);
  if (
    !["ready", "rematch", "flip"].includes(String(value.type)) ||
    (value.type === "flip" &&
      (typeof value.index !== "number" ||
        !Number.isInteger(value.index) ||
        value.index < 0 ||
        value.index > 19 ||
        typeof value.turn !== "number" ||
        !Number.isSafeInteger(value.turn) ||
        value.turn < 0)) ||
    (value.type !== "flip" && (value.index !== undefined || value.turn !== undefined))
  )
    throw new Error("Неверная команда.");
  return value as unknown as NumberHuntCommand;
}

@WebSocketGateway({
  namespace: "/number-hunt",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class NumberHuntGateway extends MinigameGateway<NumberHuntCommand, NumberHuntSnapshot> {
  constructor(numberHunt: NumberHuntService) {
    super(numberHunt, parseNumberHuntCommand, "number-hunt");
  }
  @SubscribeMessage("number-hunt:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("number-hunt:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
}
