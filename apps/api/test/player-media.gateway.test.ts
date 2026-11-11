import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { Server } from "socket.io";
import { io, type Socket } from "socket.io-client";
import { emptyPlayerMedia, type PlayerMediaPeer } from "@qwiza/minigames";
import { PlayerMediaGateway } from "../src/rooms/player-media.gateway";
import { TokenVerifier } from "livekit-server-sdk";
import { testLivekit, livekitTestKey, livekitTestSecret } from "./helpers/livekit";
import type { RoomsService } from "../src/rooms/rooms.service";
import type { SessionService } from "../src/auth/session.service";

test("authenticated media stays within its room, ignores forged owners and cleans up on disconnect", async () => {
  const http = createServer();
  const server = new Server(http);
  const namespace = server.of("/player-media");
  const livekit = testLivekit();
  const gateway = new PlayerMediaGateway(
    {
      authenticate: async (roomId: string, token: string) => {
        if (!token.startsWith(`${roomId}:`)) throw new Error("invalid token");
        return { id: token.split(":")[1] };
      },
    } as RoomsService,
    { user: async () => null } as unknown as SessionService,
    livekit.service,
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
  const connect = async (roomId: string, token: string) => {
    const socket = io(`http://127.0.0.1:${address.port}/player-media`, {
      auth: { roomId, token },
      reconnection: false,
      transports: ["websocket"],
    });
    clients.push(socket);
    await once(socket, "connect");
    return socket;
  };
  try {
    const a = await connect("one", "one:a");
    const b = await connect("one", "one:b");
    const outsider = await connect("two", "two:c");
    const peersPromise = once(b, "media:peers");
    assert.equal(
      (
        await a.emitWithAck("media:state", {
          ...emptyPlayerMedia,
          participantId: "b",
          source: { kind: "embed", url: "https://example.com/view" },
        })
      ).ok,
      true,
    );
    const [peers] = (await peersPromise) as [PlayerMediaPeer[]];
    assert.equal(
      peers.find((peer) => peer.participantId === "a")?.source?.url,
      "https://example.com/view",
    );
    assert.equal(peers.find((peer) => peer.participantId === "b")?.source, null);
    assert.equal(
      (
        await a.emitWithAck("media:state", {
          ...emptyPlayerMedia,
          source: { kind: "embed", url: "javascript:bad" },
        })
      ).ok,
      false,
    );
    const verifier = new TokenVerifier(livekitTestKey, livekitTestSecret);
    const connection = await a.emitWithAck("media:token");
    assert.equal(connection.ok, true);
    const grant = await verifier.verify(connection.token);
    assert.equal(grant.sub, `a~${a.id}`);
    assert.equal(grant.video?.room, "qwiza-one");
    assert.equal(grant.video?.canPublish, false);
    const outside = await verifier.verify((await outsider.emitWithAck("media:token")).token);
    assert.equal(outside.video?.room, "qwiza-two");
    const disconnected = once(b, "media:peers");
    a.disconnect();
    assert.deepEqual(
      ((await disconnected)[0] as PlayerMediaPeer[]).map((peer) => peer.participantId),
      ["b"],
    );
    const invalid = io(`http://127.0.0.1:${address.port}/player-media`, {
      auth: { roomId: "one", token: "two:a" },
      reconnection: false,
    });
    clients.push(invalid);
    assert.match(((await once(invalid, "connect_error"))[0] as Error).message, /Неверный ключ/);
  } finally {
    clients.forEach((socket) => socket.disconnect());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
