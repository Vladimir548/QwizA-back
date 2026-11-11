import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateEnvironment } from "../src/config/environment";
test("validates configuration at the boundary", () => {
  const database = { DATABASE_URL: "postgresql://qwesto:password@localhost:5434/qwesto" };
  assert.equal(validateEnvironment(database).PORT, 4000);
  assert.equal(validateEnvironment({ ...database, PORT: "4010" }).PORT, 4010);
  for (const port of [0, -1, 65536, "bad", 1.5])
    assert.throws(() => validateEnvironment({ ...database, PORT: port }));
  assert.throws(() => validateEnvironment({ ...database, WEB_ORIGIN: "javascript:bad" }));
  assert.throws(() => validateEnvironment({ ...database, WEB_ORIGIN: "https://example.com/path" }));
  assert.equal(validateEnvironment(database).MEDIA_IMAGE_MAX_BYTES, 3 * 1024 * 1024);
  assert.equal(validateEnvironment(database).MEDIA_VIDEO_MAX_BYTES, 100 * 1024 * 1024);
  assert.equal(validateEnvironment(database).MEDIA_AUDIO_MAX_BYTES, 20 * 1024 * 1024);
  assert.throws(() => validateEnvironment({ ...database, MEDIA_IMAGE_MAX_BYTES: 0 }));
  assert.throws(() => validateEnvironment({}));
  assert.throws(() => validateEnvironment({ DATABASE_URL: "sqlite://example" }));
});
