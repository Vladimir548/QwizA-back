import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import type { HotPotatoCommand, HotPotatoSnapshot } from "@qwiza/minigames";
import { MinigameGateway } from "./minigame-gateway";
import { parseFallingFloorCommand, parseFallingFloorInput } from "./falling-floor.gateway";
import { HotPotatoService } from "./hot-potato.service";

@WebSocketGateway({
  namespace: "/hot-potato",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class HotPotatoGateway extends MinigameGateway<HotPotatoCommand, HotPotatoSnapshot> {
  constructor(private readonly games: HotPotatoService) {
    super(games, parseFallingFloorCommand, "hot-potato");
  }
  @SubscribeMessage("hot-potato:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("hot-potato:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
  @SubscribeMessage("hot-potato:input")
  input(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    const controls = parseFallingFloorInput(input);
    const now = performance.now();
    if (!controls || now - (socket.data.lastMovementInput ?? -Infinity) < 16) return;
    socket.data.lastMovementInput = now;
    try {
      this.games.move(socket.data.roomId, socket.data.playerId, controls);
    } catch {
      /* Expired rooms no longer accept movement input. */
    }
  }
}
