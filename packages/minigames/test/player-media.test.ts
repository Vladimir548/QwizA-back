import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyPlayerMedia,
  parsePlayerMediaSource,
  parsePlayerMediaState,
} from "../src/player-media";

test("external media accepts secure viewing URLs and rejects publisher links and unsafe URLs", () => {
  for (const kind of ["embed", "audio", "video"]) {
    assert.deepEqual(
      parsePlayerMediaSource({ kind, url: " https://media.example.com/live?token=viewer " }),
      { kind, url: "https://media.example.com/live?token=viewer" },
    );
  }
  assert.ok(
    parsePlayerMediaSource({ kind: "embed", url: "https://vdo.ninja/?view=demo&password=viewer" }),
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,evil",
    "http://example.com/live",
    "https://user:password@example.com/",
    "https://vdo.ninja/?push=secret",
    "https://vdo.ninja/?view=",
    "https://vdo.ninja/?view=demo&push=secret",
    "https://example.com/" + "a".repeat(2048),
  ]) {
    assert.equal(parsePlayerMediaSource({ kind: "embed", url }), null, url);
  }
  assert.equal(parsePlayerMediaSource({ kind: "unknown", url: "https://example.com" }), null);
});

test("capture and external source cannot be published simultaneously; malformed states are rejected", () => {
  assert.deepEqual(parsePlayerMediaState(emptyPlayerMedia), emptyPlayerMedia);
  assert.deepEqual(parsePlayerMediaState({ ...emptyPlayerMedia, microphone: true }), {
    ...emptyPlayerMedia,
    microphone: true,
  });
  assert.equal(parsePlayerMediaState({ ...emptyPlayerMedia, camera: "true" }), null);
  assert.equal(parsePlayerMediaState({ ...emptyPlayerMedia, source: {} }), null);
  assert.equal(
    parsePlayerMediaState({
      ...emptyPlayerMedia,
      microphone: true,
      source: { kind: "audio", url: "https://example.com/a.wav" },
    }),
    null,
  );
  assert.equal(parsePlayerMediaState(null), null);
});
