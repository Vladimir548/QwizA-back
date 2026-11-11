import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { Server } from "socket.io";
import { io, type Socket } from "socket.io-client";
import { emptyPlayerMedia, type PlayerMediaPeer } from "@qwiza/minigames";
import { isMediaSignal, PlayerMediaGateway } from "../src/rooms/player-media.gateway";
import type { RoomsService } from "../src/rooms/rooms.service";
import type { SessionService } from "../src/auth/session.service";

test("media rejects malformed and oversized signalling", () => {
  for (const signal of [
    null,
    {},
    { type: "rollback", sdp: "" },
    { type: "offer", sdp: 3 },
    { candidate: "ice", sdpMLineIndex: -1 },
    { candidate: "x".repeat(32769) },
  ])
    assert.equal(isMediaSignal({ to: "p2", signal }), false);
  assert.ok(isMediaSignal({ to: "p2", signal: { type: "offer", sdp: "v=0" } }));
  assert.ok(
    isMediaSignal({ to: "p2", signal: { candidate: "ice", sdpMid: "0", sdpMLineIndex: 0 } }),
  );
});

test("authenticated media stays within its room, ignores forged owners and cleans up on disconnect", async () => {
  const http = createServer();
  const server = new Server(http);
  const namespace = server.of("/player-media");
  const gateway = new PlayerMediaGateway(
    {
      authenticate: async (roomId: string, token: string) => {
        if (!token.startsWith(`${roomId}:`)) throw new Error("invalid token");
        return { id: token.split(":")[1] };
      },
    } as RoomsService,
    { user: async () => null } as unknown as SessionService,
  );
  Object.defineProperty(gateway, "server", { value: namespace });
  gateway.afterInit(namespace);
  namespace.on("connection", (socket) => {
    void gateway.handleConnection(socket);
    socket.on("media:state", async (value, ack) => ack(await gateway.update(socket, value)));
    socket.on("media:signal", async (value, ack) => ack(await gateway.signal(socket, value)));
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
    assert.equal(
      (await a.emitWithAck("media:signal", { to: "c", signal: { type: "offer", sdp: "v=0" } })).ok,
      false,
    );
    assert.equal(
      (await outsider.emitWithAck("media:signal", { to: "a", signal: { candidate: "ice" } })).ok,
      false,
    );
    const signalPromise = once(b, "media:signal");
    assert.equal(
      (
        await a.emitWithAck("media:signal", {
          to: "b",
          from: "c",
          signal: {
            type: "offer",
            sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=recvonly\r\n",
          },
        })
      ).ok,
      true,
    );
    assert.equal((await signalPromise)[0].from, "a");
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
