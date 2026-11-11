import assert from "node:assert/strict";
import test from "node:test";
import { canUseBuiltinMedia, isReceiveOnlyMediaSdp } from "../src/account-access";

test("only Media and administrator roles may capture built-in audio and video", () => {
  for (const user of [null, undefined, {}, { role: "user" }, { role: "pretend" }])
    assert.equal(canUseBuiltinMedia(user), false);
  for (const role of ["media", "admin"]) assert.equal(canUseBuiltinMedia({ role }), true);
});
test("receivers can negotiate viewing without being allowed to send any audio or video", () => {
  const session = "v=0\r\n";
  const audio = "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
  const video = "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n";
  for (const direction of ["recvonly", "inactive"])
    assert.ok(
      isReceiveOnlyMediaSdp(session + audio + `a=${direction}\r\n` + video + `a=${direction}\r\n`),
    );
  assert.ok(isReceiveOnlyMediaSdp(session + "a=recvonly\r\n" + audio + video));
  assert.ok(isReceiveOnlyMediaSdp(session + "m=audio 0 UDP/TLS/RTP/SAVPF 111\r\n"));
  for (const sdp of [
    session,
    session + audio,
    session + audio + "a=sendrecv\r\n",
    session + audio + "a=sendonly\r\n",
    session + audio + "a=recvonly\r\n" + video,
    session + audio + "a=sendonly\r\na=recvonly\r\n",
    session + "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
  ])
    assert.equal(isReceiveOnlyMediaSdp(sdp), false, sdp);
});
