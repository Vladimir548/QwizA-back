import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import {
  SEQUENCE_SHAPES,
  type SequenceShape,
  type SequenceCommand,
  type SequenceSnapshot,
} from "@qwiza/minigames";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { SequenceService } from "./sequence.service";

export function parseSequenceCommand(input: unknown): SequenceCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type", "round", "answer"]);
  if (!["ready", "rematch", "submit"].includes(String(value.type)))
    throw new Error("Неверная команда.");
  if (value.type === "submit") {
    if (
      !Number.isInteger(value.round) ||
      Number(value.round) < 1 ||
      Number(value.round) > 10 ||
      !Array.isArray(value.answer) ||
      value.answer.length < 6 ||
      value.answer.length > 15 ||
      value.answer.some((shape: unknown) => !SEQUENCE_SHAPES.includes(shape as SequenceShape))
    )
      throw new Error("Неверная последовательность.");
  } else if (value.round !== undefined || value.answer !== undefined)
    throw new Error("Неверная команда.");
  return value as unknown as SequenceCommand;
}

@WebSocketGateway({
  namespace: "/sequence",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class SequenceGateway extends MinigameGateway<SequenceCommand, SequenceSnapshot> {
  constructor(sequence: SequenceService) {
    super(sequence, parseSequenceCommand, "sequence");
  }
  @SubscribeMessage("sequence:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("sequence:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
}
