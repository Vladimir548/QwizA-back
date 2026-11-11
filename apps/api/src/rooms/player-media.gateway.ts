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
import { emptyPlayerMedia, parsePlayerMediaState, type PlayerMediaPeer } from "@qwiza/minigames";
import { canUseBuiltinMedia, isReceiveOnlyMediaSdp } from "@qwiza/minigames";
import { RoomsService } from "./rooms.service";
import { cookieToken, SessionService } from "../auth/session.service";

interface MediaSocketData {
  roomId: string;
  participantId: string;
  userId: string | null;
  sessionToken?: string;
  canBroadcast: boolean;
}

@WebSocketGateway({
  namespace: "/player-media",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
})
export class PlayerMediaGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server!: Namespace;
  private readonly peers = new Map<string, Map<string, PlayerMediaPeer>>();

  constructor(
    private readonly rooms: RoomsService,
    private readonly sessions: SessionService,
  ) {}

  afterInit(server: Namespace) {
    server.use((socket, next) => {
      const { roomId, token } = socket.handshake.auth as Record<string, unknown>;
      if (typeof roomId !== "string" || typeof token !== "string")
        return next(new Error("Нужен ключ участника"));
      void this.rooms
        .authenticate(roomId, token)
        .then(async (participant) => {
          const sessionToken = cookieToken({ headers: socket.handshake.headers });
          const user = await this.sessions.user(sessionToken);
          socket.data = {
            roomId,
            participantId: participant.id,
            userId: participant.userId,
            sessionToken,
            canBroadcast: Boolean(
              user && user.id === participant.userId && canUseBuiltinMedia(user),
            ),
          } satisfies MediaSocketData;
          next();
        })
        .catch(() => next(new Error("Неверный ключ участника")));
    });
  }

  async handleConnection(socket: Socket) {
    const { roomId, participantId } = socket.data as MediaSocketData;
    const peers = this.peers.get(roomId) ?? new Map<string, PlayerMediaPeer>();
    const previous = peers.get(participantId);
    // One broadcast per participant; a second tab takes over without leaving ghost streams.
    if (previous) this.server.sockets.get(previous.connectionId)?.disconnect();
    peers.set(participantId, { participantId, connectionId: socket.id, ...emptyPlayerMedia });
    this.peers.set(roomId, peers);
    socket.emit("media:access", { canBroadcast: (socket.data as MediaSocketData).canBroadcast });
    await socket.join(roomId);
    this.broadcast(roomId);
  }

  handleDisconnect(socket: Socket) {
    const data = socket.data as MediaSocketData | undefined;
    if (!data) return;
    const peers = this.peers.get(data.roomId);
    if (peers?.get(data.participantId)?.connectionId !== socket.id) return;
    peers.delete(data.participantId);
    if (!peers.size) this.peers.delete(data.roomId);
    this.broadcast(data.roomId);
  }

  @SubscribeMessage("media:state")
  async update(@ConnectedSocket() socket: Socket, @MessageBody() value: unknown) {
    const { roomId, participantId } = socket.data as MediaSocketData;
    const state = parsePlayerMediaState(value);
    const peer = this.peers.get(roomId)?.get(participantId);
    if (!state || peer?.connectionId !== socket.id)
      return { ok: false, error: "Некорректный источник трансляции" };
    if ((state.camera || state.microphone) && !(await this.canBroadcast(socket)))
      return { ok: false, error: "Встроенные камера и микрофон доступны с ролью «Медиа»" };
    if (this.peers.get(roomId)?.get(participantId)?.connectionId !== socket.id)
      return { ok: false };
    Object.assign(peer, state);
    this.broadcast(roomId);
    return { ok: true };
  }

  @SubscribeMessage("media:signal")
  async signal(@ConnectedSocket() socket: Socket, @MessageBody() value: unknown) {
    const { roomId, participantId } = socket.data as MediaSocketData;
    const peers = this.peers.get(roomId);
    if (peers?.get(participantId)?.connectionId !== socket.id || !isMediaSignal(value))
      return { ok: false };
    const target = peers.get(value.to);
    if (!target || target.participantId === participantId) return { ok: false };
    if (
      "type" in value.signal &&
      typeof value.signal.sdp === "string" &&
      !isReceiveOnlyMediaSdp(value.signal.sdp) &&
      !(await this.canBroadcast(socket))
    )
      return { ok: false, error: "Передача встроенного аудио и видео недоступна для этой роли" };
    if (this.peers.get(roomId)?.get(participantId)?.connectionId !== socket.id)
      return { ok: false };
    this.server.to(target.connectionId).emit("media:signal", {
      from: participantId,
      connectionId: socket.id,
      signal: value.signal,
    });
    return { ok: true };
  }

  private async canBroadcast(socket: Socket) {
    const { userId, sessionToken } = socket.data as MediaSocketData;
    if (!userId || !sessionToken) return false;
    const user = await this.sessions.user(sessionToken);
    return user?.id === userId && canUseBuiltinMedia(user);
  }

  accountRoleChanged(userId: string) {
    // Reconnect both directions so revoked P2P tracks cannot survive a role change.
    for (const socket of this.server?.sockets.values() ?? []) {
      if ((socket.data as MediaSocketData).userId !== userId) continue;
      socket.emit("media:role-changed");
      socket.disconnect(true);
    }
  }

  private broadcast(roomId: string) {
    this.server.to(roomId).emit("media:peers", [...(this.peers.get(roomId)?.values() ?? [])]);
  }
}

export function isMediaSignal(
  value: unknown,
): value is { to: string; signal: Record<string, unknown> } {
  if (
    !value ||
    typeof value !== "object" ||
    !("to" in value) ||
    typeof value.to !== "string" ||
    value.to.length > 100 ||
    !("signal" in value)
  )
    return false;
  const signal = value.signal;
  if (!signal || typeof signal !== "object" || JSON.stringify(signal).length > 32768) return false;
  if ("type" in signal && ["offer", "answer"].includes(String(signal.type)))
    return "sdp" in signal && typeof signal.sdp === "string";
  return (
    "candidate" in signal &&
    typeof signal.candidate === "string" &&
    (!("sdpMid" in signal) || signal.sdpMid === null || typeof signal.sdpMid === "string") &&
    (!("sdpMLineIndex" in signal) ||
      signal.sdpMLineIndex === null ||
      (typeof signal.sdpMLineIndex === "number" &&
        Number.isInteger(signal.sdpMLineIndex) &&
        signal.sdpMLineIndex >= 0))
  );
}
