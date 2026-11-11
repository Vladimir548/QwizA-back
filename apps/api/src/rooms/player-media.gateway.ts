import { Logger } from "@nestjs/common";
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
import { canUseBuiltinMedia, playerMediaIdentity } from "@qwiza/minigames";
import { LivekitService } from "./livekit.service";
import { RoomsService } from "./rooms.service";
import { cookieToken, SessionService } from "../auth/session.service";

interface MediaSocketData {
  roomId: string;
  participantId: string;
  userId: string | null;
  sessionToken?: string;
  canBroadcast: boolean;
  revocation?: Promise<void>;
}

@WebSocketGateway({
  namespace: "/player-media",
  cors: { origin: ["http://localhost:3000", "http://127.0.0.1:3000"], credentials: true },
})
export class PlayerMediaGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server!: Namespace;
  private readonly peers = new Map<string, Map<string, PlayerMediaPeer>>();
  private readonly logger = new Logger(PlayerMediaGateway.name);

  constructor(
    private readonly rooms: RoomsService,
    private readonly sessions: SessionService,
    private readonly livekit: LivekitService,
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
    void this.revoke(socket).catch(() =>
      this.logger.warn("Не удалось отключить участника LiveKit"),
    );
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

  @SubscribeMessage("media:token")
  async connection(@ConnectedSocket() socket: Socket) {
    const { roomId, participantId } = socket.data as MediaSocketData;
    try {
      await this.rooms.authenticate(roomId, socket.handshake.auth.token as string);
      const allowed = await this.canBroadcast(socket);
      if (this.peers.get(roomId)?.get(participantId)?.connectionId !== socket.id)
        return { ok: false, error: "Подключение заменено другой вкладкой" };
      const connection = await this.livekit.connection(roomId, participantId, socket.id, allowed);
      return { ok: true, ...connection };
    } catch {
      return { ok: false, error: "Видеосервер недоступен. Попробуй подключиться позже." };
    }
  }

  private async canBroadcast(socket: Socket) {
    const { userId, sessionToken } = socket.data as MediaSocketData;
    if (!userId || !sessionToken) return false;
    const user = await this.sessions.user(sessionToken);
    return user?.id === userId && canUseBuiltinMedia(user);
  }

  async accountRoleChanged(userId: string) {
    const sockets = [...(this.server?.sockets.values() ?? [])].filter(
      (socket) => (socket.data as MediaSocketData).userId === userId,
    );
    for (const socket of sockets) socket.emit("media:role-changed");
    try {
      await Promise.all(sockets.map((socket) => this.revoke(socket)));
    } finally {
      for (const socket of sockets) socket.disconnect(true);
    }
  }

  private revoke(socket: Socket) {
    const data = socket.data as MediaSocketData;
    return (data.revocation ??= this.livekit.disconnect(
      data.roomId,
      playerMediaIdentity(data.participantId, socket.id),
    ));
  }

  private broadcast(roomId: string) {
    this.server.to(roomId).emit("media:peers", [...(this.peers.get(roomId)?.values() ?? [])]);
  }
}
