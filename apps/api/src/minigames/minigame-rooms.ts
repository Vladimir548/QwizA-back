import {
  BadRequestException,
  NotFoundException,
  OnModuleDestroy,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  MinigamePlayer,
  MinigameSession,
  MinigameCommand,
  MinigameSnapshot,
} from "@qwiza/minigames";

interface GameRoom<Match> {
  id: string;
  code: string;
  revision: number;
  touchedAt: number;
  match: Match;
  credentials: Map<string, string>;
  connections: Map<string, Set<string>>;
  commands: Map<string, Set<string>>;
  sealed?: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

export abstract class MinigameRooms<
  Match extends { players: MinigamePlayer[] },
  Command extends MinigameCommand,
  Settings,
  Snapshot extends MinigameSnapshot,
> implements OnModuleDestroy {
  protected abstract newMatch(settings: Settings, roundId: string): Match;
  protected abstract addPlayer(match: Match, id: string, name: string): void;
  protected abstract advance(match: Match, now: number): void;
  protected abstract apply(
    match: Match,
    playerId: string,
    command: Command,
    now: number,
    nextRoundId: string,
  ): void;
  protected abstract view(
    match: Match,
    playerId?: string,
  ): Omit<Snapshot, "id" | "code" | "revision" | "serverTime">;
  protected abstract deadline(match: Match): number | null;
  protected presenceChanged(match: Match, now: number): void {
    void match;
    void now;
  }

  /** Continuous controls update targets; the game's tick publishes the next state. */
  protected updateInput(id: string, update: (match: Match, now: number) => void) {
    const room = this.room(id);
    update(room.match, this.now());
  }

  private readonly rooms = new Map<string, GameRoom<Match>>();
  private readonly listeners = new Set<(id: string) => void>();
  private readonly cleanup = setInterval(() => this.prune(), 60000).unref();

  now() {
    return performance.timeOrigin + performance.now();
  }

  private prune() {
    for (const [id, room] of this.rooms) {
      if (this.now() - room.touchedAt < ROOM_TTL_MS) continue;
      clearTimeout(room.timer);
      this.rooms.delete(id);
    }
  }

  private room(id: string) {
    const room = this.rooms.get(id);
    if (!room)
      throw new NotFoundException(
        "Стол не найден. Возможно, сервер был перезапущен. Создай новый.",
      );
    return room;
  }

  private reserve(room: GameRoom<Match>, displayName: string): MinigameSession {
    if (room.sealed) throw new BadRequestException("Участники испытания уже определены.");
    const name = displayName.trim();
    if (!name || name.length > 24) throw new BadRequestException("Введи имя от 1 до 24 символов.");
    const playerId = randomUUID();
    const token = randomBytes(32).toString("hex");
    try {
      this.addPlayer(room.match, playerId, name);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    room.credentials.set(tokenHash(token), playerId);
    this.publish(room);
    return { roomId: room.id, playerId, token };
  }

  create(displayName: string, settings: Settings) {
    this.prune();
    if (this.rooms.size >= 200)
      throw new BadRequestException("Сейчас все столы заняты. Попробуй позже.");
    const id = randomUUID();
    let match: Match;
    try {
      match = this.newMatch(settings, randomUUID());
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const room: GameRoom<Match> = {
      id,
      code: id.slice(0, 6).toUpperCase(),
      revision: 0,
      touchedAt: this.now(),
      match,
      credentials: new Map(),
      connections: new Map(),
      commands: new Map(),
    };
    this.rooms.set(id, room);
    try {
      return this.reserve(room, displayName);
    } catch (error) {
      this.rooms.delete(id);
      throw error;
    }
  }

  join(id: string, displayName: string) {
    return this.reserve(this.room(id), displayName);
  }

  seal(id: string) {
    this.room(id).sealed = true;
  }

  authenticate(id: string, token: unknown) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException("Неверный ключ игрока.");
    const playerId = this.room(id).credentials.get(tokenHash(token));
    if (!playerId) throw new UnauthorizedException("Неверный ключ игрока.");
    return playerId;
  }

  connect(id: string, playerId: string, socketId: string, connected: boolean) {
    const room = this.room(id);
    const connections = room.connections.get(playerId) ?? new Set<string>();
    if (connected) connections.add(socketId);
    else connections.delete(socketId);
    room.connections.set(playerId, connections);
    const player = room.match.players.find((candidate) => candidate.id === playerId)!;
    player.connected = connections.size > 0;
    if (!player.connected) for (const participant of room.match.players) participant.ready = false;
    this.presenceChanged(room.match, this.now());
    this.publish(room);
  }

  snapshot(id: string, playerId?: string): Snapshot {
    const room = this.room(id);
    this.advance(room.match, this.now());
    return {
      id,
      code: room.code,
      revision: room.revision,
      serverTime: this.now(),
      ...this.view(room.match, playerId),
    } as Snapshot;
  }

  command(id: string, playerId: string, command: Command) {
    const room = this.room(id);
    if (room.sealed && "type" in command && command.type === "rematch")
      throw new BadRequestException("Испытание темы проводится один раз.");
    const handled = room.commands.get(playerId) ?? new Set<string>();
    if (handled.has(command.id)) return this.snapshot(id, playerId);
    try {
      this.apply(room.match, playerId, command, this.now(), randomUUID());
      handled.add(command.id);
      if (handled.size > 100) handled.delete(handled.values().next().value!);
      room.commands.set(playerId, handled);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    } finally {
      this.publish(room);
    }
    return this.snapshot(id, playerId);
  }

  subscribe(listener: (id: string) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(room: GameRoom<Match>) {
    room.revision += 1;
    room.touchedAt = this.now();
    clearTimeout(room.timer);
    const at = this.deadline(room.match);
    if (at !== null)
      room.timer = setTimeout(
        () => {
          this.advance(room.match, this.now());
          this.publish(room);
        },
        Math.max(1, at - this.now() + 1),
      ).unref();
    for (const listener of this.listeners) listener(room.id);
  }

  onModuleDestroy() {
    clearInterval(this.cleanup);
    for (const room of this.rooms.values()) clearTimeout(room.timer);
    this.listeners.clear();
    this.rooms.clear();
  }
}
