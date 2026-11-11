import { Logger, OnModuleInit } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Namespace, Socket } from "socket.io";
import { RoomsService } from "./rooms.service";
import type { RoomCommandInput } from "./rooms.types";

interface RoomSocketData {
  roomId: string;
  participantId: string;
}

@WebSocketGateway({
  namespace: "/rooms",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
})
export class RoomsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() private server!: Namespace;
  private readonly logger = new Logger(RoomsGateway.name);

  constructor(private readonly rooms: RoomsService) {}

  afterInit(server: Namespace) {
    server.use((socket, next) => {
      const { roomId, token } = socket.handshake.auth as { roomId?: unknown; token?: unknown };
      if (typeof roomId !== "string" || typeof token !== "string") {
        next(new Error("Нужен ключ участника"));
        return;
      }
      void this.rooms
        .authenticate(roomId, token)
        .then((participant) => {
          socket.data = { roomId, participantId: participant.id } satisfies RoomSocketData;
          next();
        })
        .catch(() => next(new Error("Неверный ключ участника")));
    });
  }

  onModuleInit() {
    this.rooms.subscribe((roomId) => {
      void this.rooms
        .publicSnapshot(roomId)
        .then((snapshot) => this.server.to(roomId).emit("room:state", snapshot))
        .catch((error: unknown) => this.logger.warn(`Room snapshot failed: ${String(error)}`));
    });
  }

  async handleConnection(socket: Socket) {
    const data = socket.data as RoomSocketData;
    await socket.join(data.roomId);
    this.rooms.setConnected(data.participantId, socket.id, true, data.roomId);
    socket.emit("room:state", await this.rooms.publicSnapshot(data.roomId));
  }

  handleDisconnect(socket: Socket) {
    const data = socket.data as RoomSocketData | undefined;
    if (!data?.roomId || !data.participantId) return;
    this.rooms.setConnected(data.participantId, socket.id, false, data.roomId);
  }

  @SubscribeMessage("room:command")
  async command(@ConnectedSocket() socket: Socket, @MessageBody() input: RoomCommandInput) {
    const data = socket.data as RoomSocketData;
    try {
      return await this.rooms.command(data.roomId, data.participantId, input);
    } catch (error) {
      this.logger.warn(`Room command rejected: ${String(error)}`);
      return { ok: false, error: "Не удалось обработать команду", serverReceivedAt: Date.now() };
    }
  }
}
