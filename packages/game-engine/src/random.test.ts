import assert from "node:assert/strict";
import test from "node:test";
import { chacha20Word } from "./random.js";

test("ChaCha20 block output matches RFC 8439 Appendix A.1 test vector", () => {
  assert.equal(chacha20Word("00".repeat(32), 0), 0xade0b876);
  assert.equal(chacha20Word("00".repeat(32), 1), 0xbee7079f);
});

test("private random seeds and counters are validated", () => {
  assert.throws(() => chacha20Word("ab", 0), /exactly 256 bits/);
  assert.throws(() => chacha20Word("00".repeat(32), -1), /unsigned 32-bit/);
  assert.throws(() => chacha20Word("00".repeat(32), 0x1_0000_0000), /unsigned 32-bit/);
});
