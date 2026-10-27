const CONSTANTS = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574] as const;

function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function quarterRound(state: Uint32Array, a: number, b: number, c: number, d: number): void {
  state[a] = (state[a]! + state[b]!) >>> 0;
  state[d] = rotateLeft(state[d]! ^ state[a]!, 16);
  state[c] = (state[c]! + state[d]!) >>> 0;
  state[b] = rotateLeft(state[b]! ^ state[c]!, 12);
  state[a] = (state[a]! + state[b]!) >>> 0;
  state[d] = rotateLeft(state[d]! ^ state[a]!, 8);
  state[c] = (state[c]! + state[d]!) >>> 0;
  state[b] = rotateLeft(state[b]! ^ state[c]!, 7);
}

/**
 * Return the first word of one RFC 8439 ChaCha20 block using a zero nonce.
 * Each counter must be unique for a given key. Separate counter ranges are
 * reserved by the match engine for rolls, deck shuffles, and deck reinsertion.
 */
export function chacha20Word(keyHex: string, counter: number): number {
  if (!/^[\da-f]{64}$/i.test(keyHex)) throw new Error("A private random seed must be exactly 256 bits of hex.");
  if (!Number.isSafeInteger(counter) || counter < 0 || counter > 0xffffffff) throw new Error("ChaCha20 block counter must be an unsigned 32-bit integer.");

  const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(keyHex.slice(index * 2, index * 2 + 2), 16));
  const keyWords = new Uint32Array(8);
  for (let index = 0; index < keyWords.length; index += 1) {
    const offset = index * 4;
    keyWords[index] = (keyBytes[offset]! | (keyBytes[offset + 1]! << 8) | (keyBytes[offset + 2]! << 16) | (keyBytes[offset + 3]! << 24)) >>> 0;
  }

  const initial = new Uint32Array(16);
  initial.set(CONSTANTS, 0);
  initial.set(keyWords, 4);
  initial[12] = counter >>> 0;
  const state = new Uint32Array(initial);
  for (let round = 0; round < 10; round += 1) {
    quarterRound(state, 0, 4, 8, 12);
    quarterRound(state, 1, 5, 9, 13);
    quarterRound(state, 2, 6, 10, 14);
    quarterRound(state, 3, 7, 11, 15);
    quarterRound(state, 0, 5, 10, 15);
    quarterRound(state, 1, 6, 11, 12);
    quarterRound(state, 2, 7, 8, 13);
    quarterRound(state, 3, 4, 9, 14);
  }
  return (state[0]! + initial[0]!) >>> 0;
}

export const PRIVATE_RANDOM_COUNTERS = {
  game: 0x00000000,
  mutationShuffle: 0x10000000,
  researchShuffle: 0x20000000,
  mutationReinsert: 0x30000000,
} as const;
