import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { TokenVerifier } from "livekit-server-sdk";
import { LivekitService } from "../src/rooms/livekit.service";
import { testLivekit, livekitTestKey, livekitTestSecret } from "./helpers/livekit";

test("LiveKit credentials bind a short-lived identity to one room and restrict media sources", async () => {
  const { service } = testLivekit();
  const verifier = new TokenVerifier(livekitTestKey, livekitTestSecret);
  for (const canPublish of [true, false]) {
    const result = await service.connection("room-1", "player-1", "socket-1", canPublish);
    const grant = await verifier.verify(result.token);
    assert.equal(result.url, "wss://media.example.test");
    assert.equal(grant.sub, "player-1~socket-1");
    assert.equal(grant.video?.room, "qwiza-room-1");
    assert.equal(grant.video?.roomJoin, true);
    assert.equal(grant.video?.canSubscribe, true);
    assert.equal(grant.video?.canPublish, canPublish);
    assert.equal(grant.video?.canPublishData, false);
    assert.equal(grant.video?.roomAdmin, undefined);
    assert.ok(grant.exp && grant.exp <= Date.now() / 1000 + 121);
    assert.deepEqual(grant.video?.canPublishSources, canPublish ? ["camera", "microphone"] : []);
  }
});

test("missing LiveKit configuration never issues a token", async () => {
  const service = new LivekitService(new ConfigService());
  await assert.rejects(service.connection("room", "player", "socket", true), /не настроен/);
});
