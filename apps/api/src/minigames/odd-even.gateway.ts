import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import {
  ODD_EVEN_LAPS,
  ODD_EVEN_MAX_PLAYERS,
  ODD_EVEN_STARTING_CHIPS,
  type OddEvenCommand,
  type OddEvenSnapshot,
} from "@qwiza/minigames";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { OddEvenService } from "./odd-even.service";

export function parseOddEvenCommand(input: unknown): OddEvenCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type", "turn", "amount", "parity"]);
  const { type, turn, amount, parity } = value;
  const playing = type === "bet" || type === "guess";
  if (
    (!playing && type !== "ready" && type !== "rematch") ||
    (playing
      ? typeof turn !== "number" ||
        !Number.isInteger(turn) ||
        turn < 1 ||
        turn > ODD_EVEN_LAPS * ODD_EVEN_MAX_PLAYERS
      : turn !== undefined) ||
    (type === "bet"
      ? typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount < 1 ||
        amount > ODD_EVEN_STARTING_CHIPS * ODD_EVEN_MAX_PLAYERS
      : amount !== undefined) ||
    (type === "guess" ? parity !== "even" && parity !== "odd" : parity !== undefined)
  )
    throw new Error("Неверная команда.");
  return value as unknown as OddEvenCommand;
}

@WebSocketGateway({
  namespace: "/odd-even",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class OddEvenGateway extends MinigameGateway<OddEvenCommand, OddEvenSnapshot> {
  constructor(game: OddEvenService) {
    super(game, parseOddEvenCommand, "odd-even");
  }
  @SubscribeMessage("odd-even:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("odd-even:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
}
