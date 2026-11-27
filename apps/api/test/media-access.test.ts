import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { Server } from "socket.io";
import { io, type Socket } from "socket.io-client";
import { emptyPlayerMedia } from "@qwiza/minigames";
import { PlayerMediaGateway } from "../src/rooms/player-media.gateway";
import type { RoomsService } from "../src/rooms/rooms.service";
import type { SessionService } from "../src/auth/session.service";
import { MinigameRoomAccess } from "../src/minigames/minigame-room-access";
import { HockeyService } from "../src/minigames/hockey.service";
import type { ModuleRef } from "@nestjs/core";
import { TokenVerifier } from "livekit-server-sdk";
import { testLivekit, livekitTestKey, livekitTestSecret } from "./helpers/livekit";

test("media role gates LiveKit publishing, keeps guest receiving and external links, and revokes open streams", async () => {
  const http = createServer();
  const server = new Server(http);
  const namespace = server.of("/player-media");
  const roles: Record<string, string> = { m: "media", a: "admin", u: "user" };
  const tokens = { m: "m".repeat(44), a: "a".repeat(44), u: "u".repeat(44) };
  const livekit = testLivekit();
  const verifier = new TokenVerifier(livekitTestKey, livekitTestSecret);
  const hockey = new HockeyService();
  const minigameRooms = new MinigameRoomAccess({
    get: (service: unknown) => {
      assert.equal(service, HockeyService);
      return hockey;
    },
  } as ModuleRef);
  const gateway = new PlayerMediaGateway(
    {
      authenticate: async (_room: string, token: string) => ({
        id: token,
        userId: token === "guest" ? null : token,
      }),
    } as unknown as RoomsService,
    {
      user: async (token?: string) => {
        const id = Object.entries(tokens).find(([, value]) => value === token)?.[0];
        return id ? { id, role: roles[id] } : null;
      },
    } as unknown as SessionService,
    livekit.service,
    minigameRooms,
  );
  Object.defineProperty(gateway, "server", { value: namespace });
  gateway.afterInit(namespace);
  namespace.on("connection", (socket) => {
    void gateway.handleConnection(socket);
    socket.on("media:state", async (value, ack) => ack(await gateway.update(socket, value)));
    socket.on("media:token", async (ack) => ack(await gateway.connection(socket)));
    socket.on("disconnect", () => gateway.handleDisconnect(socket));
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const clients: Socket[] = [];
  const connect = async (id: string, cookie?: string, roomId = "room", minigame?: string) => {
    const socket = io(`http://127.0.0.1:${address.port}/player-media`, {
      auth: { roomId, token: id, minigame },
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: cookie ? { cookie: `qwesto_session=${cookie}` } : {},
    });
    clients.push(socket);
    const access = once(socket, "media:access");
    await once(socket, "connect");
    return { socket, access: (await access)[0].canBroadcast };
  };
  try {
    const media = await connect("m", tokens.m),
      admin = await connect("a", tokens.a),
      regular = await connect("u", tokens.u),
      guest = await connect("guest");
    assert.equal(media.access, true);
    assert.equal(admin.access, true);
    assert.equal(regular.access, false);
    assert.equal(guest.access, false);
    const first = hockey.create("Первый", undefined);
    const second = hockey.join(first.roomId, "Второй");
    const broadcaster = await connect(first.token, tokens.m, first.roomId, "hockey");
    const viewer = await connect(second.token, tokens.u, second.roomId, "hockey");
    assert.equal(broadcaster.access, true);
    assert.equal(viewer.access, false);
    const grant = await verifier.verify(
      (await broadcaster.socket.emitWithAck("media:token")).token,
    );
    assert.equal(grant.video?.room, `qwiza-minigame-hockey-${first.roomId}`);
    assert.equal(grant.sub, `${first.playerId}~${broadcaster.socket.id}`);
    assert.equal(grant.video?.canPublish, true);
    const invalid = io(`http://127.0.0.1:${address.port}/player-media`, {
      auth: { roomId: first.roomId, token: "m", minigame: "hockey" },
      reconnection: false,
      extraHeaders: { cookie: `qwesto_session=${tokens.m}` },
    });
    clients.push(invalid);
    assert.match(((await once(invalid, "connect_error"))[0] as Error).message, /Неверный ключ/);
    for (const source of [regular, guest]) {
      assert.equal(
        (await source.socket.emitWithAck("media:state", { ...emptyPlayerMedia, camera: true })).ok,
        false,
      );
      assert.equal(
        (await source.socket.emitWithAck("media:state", { ...emptyPlayerMedia, microphone: true }))
          .ok,
        false,
      );
      assert.equal(
        (
          await source.socket.emitWithAck("media:state", {
            ...emptyPlayerMedia,
            source: { kind: "embed", url: "https://vdo.ninja/?view=test" },
          })
        ).ok,
        true,
      );
      const grant = await verifier.verify((await source.socket.emitWithAck("media:token")).token);
      assert.equal(grant.video?.canPublish, false);
      assert.equal(grant.video?.canSubscribe, true);
    }
    for (const source of [media, admin]) {
      assert.equal(
        (
          await source.socket.emitWithAck("media:state", {
            ...emptyPlayerMedia,
            camera: true,
            microphone: true,
          })
        ).ok,
        true,
      );
      const grant = await verifier.verify((await source.socket.emitWithAck("media:token")).token);
      assert.equal(grant.video?.canPublish, true);
    }
    roles.m = "user";
    assert.equal(
      (await media.socket.emitWithAck("media:state", { ...emptyPlayerMedia, camera: true })).ok,
      false,
    );
    const changed = once(media.socket, "media:role-changed"),
      disconnected = once(media.socket, "disconnect"),
      minigameDisconnected = once(broadcaster.socket, "disconnect");
    await gateway.accountRoleChanged("m");
    await Promise.all([changed, disconnected, minigameDisconnected]);
    assert.equal(media.socket.connected, false);
    assert.equal(broadcaster.socket.connected, false);
    assert.ok(livekit.disconnected.some((identity) => identity.startsWith("room/m~")));
    const stolen = await connect("m", tokens.a);
    assert.equal(stolen.access, false);
    const stolenGrant = await verifier.verify(
      (await stolen.socket.emitWithAck("media:token")).token,
    );
    assert.equal(stolenGrant.video?.canPublish, false);
    assert.equal(
      (await stolen.socket.emitWithAck("media:state", { ...emptyPlayerMedia, camera: true })).ok,
      false,
    );
  } finally {
    clients.forEach((socket) => socket.disconnect());
    hockey.onModuleDestroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
