import assert from "node:assert/strict";
import test from "node:test";
import { canUseBuiltinMedia } from "../src/account-access";

test("only Media and administrator roles may capture built-in audio and video", () => {
  for (const user of [null, undefined, {}, { role: "user" }, { role: "pretend" }])
    assert.equal(canUseBuiltinMedia(user), false);
  for (const role of ["media", "admin"]) assert.equal(canUseBuiltinMedia({ role }), true);
});
