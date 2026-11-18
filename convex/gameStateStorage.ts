import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import type { GameState } from "../packages/game-engine/src/index.js";

/** Store room state as Convex bytes so hot room reads and writes stay small. */
export function encodeGameState(state: GameState): ArrayBuffer {
  const compressed = gzipSync(strToU8(JSON.stringify(state)), { level: 1 });
  return Uint8Array.from(compressed).buffer;
}

/** Existing rooms remain readable until their next write migrates them. */
export function decodeGameState(value: unknown): GameState {
  if (value instanceof ArrayBuffer) {
    return JSON.parse(strFromU8(gunzipSync(new Uint8Array(value)))) as GameState;
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return JSON.parse(strFromU8(gunzipSync(bytes))) as GameState;
  }
  return value as GameState;
}
