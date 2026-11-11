import { OnModuleDestroy } from "@nestjs/common";
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from "@nestjs/websockets";
import { isUUID } from "class-validator";
import type { Namespace, Socket } from "socket.io";
import type { MinigameAck } from "@qwiza/minigames";

interface SocketData {
  roomId: string;
  playerId: string;
}
interface SocketService<Command, Snapshot> {
  authenticate(id: string, token: unknown): string;
  connect(id: string, playerId: string, socketId: string, connected: boolean): void;
  snapshot(id: string, playerId?: string): Snapshot;
  command(id: string, playerId: string, command: Command): Snapshot;
  subscribe(listener: (id: string) => void): () => void;
  now(): number;
}

export function commandEnvelope(input: unknown, keys: string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Неверная команда.");
  const value = input as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    !isUUID(value.id) ||
    typeof value.roundId !== "string" ||
    !isUUID(value.roundId) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("Неверная команда.");
  return value;
}

export abstract class MinigameGateway<Command, Snapshot>
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private unsubscribe?: () => void;
  protected constructor(
    private readonly service: SocketService<Command, Snapshot>,
    private readonly parse: (input: unknown) => Command,
    private readonly prefix: string,
  ) {}

  afterInit(server: Namespace) {
    server.use((socket, next) => {
      try {
        const { roomId, token } = socket.handshake.auth;
        if (typeof roomId !== "string" || !isUUID(roomId)) throw new Error("Неверный стол.");
        socket.data = {
          roomId,
          playerId: this.service.authenticate(roomId, token),
        } satisfies SocketData;
        next();
      } catch (error) {
        next(new Error((error as Error).message));
      }
    });
    this.unsubscribe = this.service.subscribe((id) => {
      for (const socketId of server.adapter.rooms.get(id) ?? []) {
        const client = server.sockets.get(socketId);
        if (client)
          client.emit(`${this.prefix}:state`, this.service.snapshot(id, client.data.playerId));
      }
    });
  }
  async handleConnection(socket: Socket) {
    const { roomId, playerId } = socket.data as SocketData;
    await socket.join(roomId);
    this.service.connect(roomId, playerId, socket.id, true);
  }
  handleDisconnect(socket: Socket) {
    const { roomId, playerId } = socket.data as Partial<SocketData>;
    if (!roomId || !playerId) return;
    try {
      this.service.connect(roomId, playerId, socket.id, false);
    } catch {
      /* Expired rooms no longer need presence updates. */
    }
  }
  protected syncSocket(socket: Socket) {
    return {
      serverTime: this.service.now(),
      snapshot: this.service.snapshot(socket.data.roomId, socket.data.playerId),
    };
  }
  protected execute(socket: Socket, input: unknown): MinigameAck<Snapshot> {
    try {
      return {
        ok: true,
        snapshot: this.service.command(socket.data.roomId, socket.data.playerId, this.parse(input)),
      };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
  onModuleDestroy() {
    this.unsubscribe?.();
  }
}
