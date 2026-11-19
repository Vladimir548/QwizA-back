import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Socket } from "socket.io";
import type { IceRaceCommand, IceRaceSnapshot } from "@qwiza/minigames";
import { MinigameGateway } from "./minigame-gateway";
import { parseFallingFloorCommand, parseFallingFloorInput } from "./falling-floor.gateway";
import { IceRaceService } from "./ice-race.service";

@WebSocketGateway({
  namespace: "/ice-race",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
  maxHttpBufferSize: 4096,
})
export class IceRaceGateway extends MinigameGateway<IceRaceCommand, IceRaceSnapshot> {
  constructor(private readonly races: IceRaceService) {
    super(races, parseFallingFloorCommand, "ice-race");
  }
  @SubscribeMessage("ice-race:sync")
  sync(@ConnectedSocket() socket: Socket) {
    return this.syncSocket(socket);
  }
  @SubscribeMessage("ice-race:command")
  command(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    return this.execute(socket, input);
  }
  @SubscribeMessage("ice-race:input")
  input(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    const controls = parseFallingFloorInput(input);
    const now = performance.now();
    if (!controls || now - (socket.data.lastIceInput ?? -Infinity) < 16) return;
    socket.data.lastIceInput = now;
    try {
      this.races.move(socket.data.roomId, socket.data.playerId, controls);
    } catch {
      /* Expired rooms no longer accept movement input. */
    }
  }
}
