import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import type { ShellCommand, ShellSnapshot } from "@qwiza/minigames";
import { commandEnvelope, MinigameGateway } from "./minigame-gateway";
import { ShellGameService } from "./shell-game.service";
export function parseShellCommand(input: unknown): ShellCommand {
  const value = commandEnvelope(input, ["id", "roundId", "type", "slot"]);
  if (value.type === "choose") {
    if (!Number.isInteger(value.slot) || Number(value.slot) < 0 || Number(value.slot) > 2)
      throw new Error("Выбери один из трёх стаканов.");
  } else if ((value.type !== "ready" && value.type !== "rematch") || value.slot !== undefined)
    throw new Error("Неверная команда.");
  return value as unknown as ShellCommand;
}
@WebSocketGateway({
  namespace: "/shell-game",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class ShellGameGateway extends MinigameGateway<ShellCommand, ShellSnapshot> {
  constructor(shells: ShellGameService) {
    super(shells, parseShellCommand, "shell-game");
  }
  @SubscribeMessage("shell-game:sync") sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("shell-game:command") command(
    @ConnectedSocket() socket: Socket,
    @MessageBody() input: unknown,
  ) {
    return this.execute(socket, input);
  }
}
