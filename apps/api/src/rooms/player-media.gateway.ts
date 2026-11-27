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
import { MinigameRoomAccess } from "../minigames/minigame-room-access";

interface MediaSocketData {
  roomId: string;
  mediaRoomId: string;
  minigame?: string;
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
    private readonly minigameRooms: MinigameRoomAccess,
  ) {}

  afterInit(server: Namespace) {
    server.use((socket, next) => {
      const { roomId, token, minigame } = socket.handshake.auth as Record<string, unknown>;
      if (
        typeof roomId !== "string" ||
        typeof token !== "string" ||
        (minigame !== undefined && typeof minigame !== "string")
      )
        return next(new Error("Нужен ключ участника"));
      void this.authenticate(roomId, token, minigame)
        .then(async (participant) => {
          const sessionToken = cookieToken({ headers: socket.handshake.headers });
          const user = await this.sessions.user(sessionToken);
          const userId = minigame === undefined ? participant.userId : (user?.id ?? null);
          socket.data = {
            roomId,
            mediaRoomId: minigame === undefined ? roomId : `minigame-${minigame}-${roomId}`,
            minigame,
            participantId: participant.id,
            userId,
            sessionToken,
            canBroadcast: Boolean(user && user.id === userId && canUseBuiltinMedia(user)),
          } satisfies MediaSocketData;
          next();
        })
        .catch(() => next(new Error("Неверный ключ участника")));
    });
  }

  private async authenticate(roomId: string, token: string, minigame?: string) {
    if (minigame === undefined) return this.rooms.authenticate(roomId, token);
    return { id: this.minigameRooms.authenticate(minigame, roomId, token), userId: null };
  }

  async handleConnection(socket: Socket) {
    const { mediaRoomId: roomId, participantId } = socket.data as MediaSocketData;
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
    const peers = this.peers.get(data.mediaRoomId);
    if (peers?.get(data.participantId)?.connectionId !== socket.id) return;
    peers.delete(data.participantId);
    if (!peers.size) this.peers.delete(data.mediaRoomId);
    this.broadcast(data.mediaRoomId);
  }

  @SubscribeMessage("media:state")
  async update(@ConnectedSocket() socket: Socket, @MessageBody() value: unknown) {
    const { mediaRoomId: roomId, participantId } = socket.data as MediaSocketData;
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
    const { roomId, mediaRoomId, minigame, participantId } = socket.data as MediaSocketData;
    try {
      await this.authenticate(roomId, socket.handshake.auth.token as string, minigame);
      const allowed = await this.canBroadcast(socket);
      if (this.peers.get(mediaRoomId)?.get(participantId)?.connectionId !== socket.id)
        return { ok: false, error: "Подключение заменено другой вкладкой" };
      const connection = await this.livekit.connection(
        mediaRoomId,
        participantId,
        socket.id,
        allowed,
      );
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
      data.mediaRoomId,
      playerMediaIdentity(data.participantId, socket.id),
    ));
  }

  private broadcast(roomId: string) {
    this.server.to(roomId).emit("media:peers", [...(this.peers.get(roomId)?.values() ?? [])]);
  }
}
