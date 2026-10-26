export type DigestEncoding = 'hex' | 'base64url';

export interface Sha256 {
  update(data: string | Uint8Array): Sha256;
  digest(encoding: DigestEncoding): string;
  copy(): Sha256;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const encoder = new TextEncoder();

const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

class PortableSha256 implements Sha256 {
  readonly #state = Uint32Array.from(INITIAL);
  readonly #block = new Uint8Array(64);
  readonly #words = new Uint32Array(64);
  #filled = 0;
  #length = 0;
  #done = false;

  update(data: string | Uint8Array): Sha256 {
    if (this.#done) throw new Error('A sha256 digest was already taken');
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    this.#length += bytes.length;
    let at = 0;
    if (this.#filled > 0) {
      const taken = Math.min(64 - this.#filled, bytes.length);
      this.#block.set(bytes.subarray(0, taken), this.#filled);
      this.#filled += taken;
      at = taken;
      if (this.#filled < 64) return this;
      this.#compress(this.#block, 0);
      this.#filled = 0;
    }
    for (; at + 64 <= bytes.length; at += 64) this.#compress(bytes, at);
    if (at < bytes.length) {
      this.#block.set(bytes.subarray(at), 0);
      this.#filled = bytes.length - at;
    }
    return this;
  }

  copy(): Sha256 {
    if (this.#done) throw new Error('A sha256 digest was already taken');
    const copied = new PortableSha256();
    copied.#state.set(this.#state);
    copied.#block.set(this.#block);
    copied.#filled = this.#filled;
    copied.#length = this.#length;
    return copied;
  }

  digest(encoding: DigestEncoding): string {
    if (this.#done) throw new Error('A sha256 digest was already taken');
    this.#done = true;
    const bits = this.#length * 8;
    this.#block[this.#filled++] = 0x80;
    if (this.#filled > 56) {
      this.#block.fill(0, this.#filled);
      this.#compress(this.#block, 0);
      this.#filled = 0;
    }
    this.#block.fill(0, this.#filled, 56);
    const view = new DataView(this.#block.buffer);
    view.setUint32(56, Math.floor(bits / 0x1_0000_0000));
    view.setUint32(60, bits >>> 0);
    this.#compress(this.#block, 0);
    const out = new Uint8Array(32);
    const written = new DataView(out.buffer);
    for (let index = 0; index < 8; index++) written.setUint32(index * 4, this.#state[index]!);
    return encoding === 'hex' ? hex(out) : base64url(out);
  }

  #compress(block: Uint8Array, offset: number): void {
    const w = this.#words;
    for (let index = 0; index < 16; index++) {
      const at = offset + index * 4;
      w[index] = (block[at]! << 24) | (block[at + 1]! << 16) | (block[at + 2]! << 8) | block[at + 3]!;
    }
    for (let index = 16; index < 64; index++) {
      const back15 = w[index - 15]!;
      const back2 = w[index - 2]!;
      const s0 = rotate(back15, 7) ^ rotate(back15, 18) ^ (back15 >>> 3);
      const s1 = rotate(back2, 17) ^ rotate(back2, 19) ^ (back2 >>> 10);
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) | 0;
    }
    const state = this.#state;
    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;
    for (let index = 0; index < 64; index++) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + K[index]! + w[index]!) | 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    state[0] = (state[0]! + a) | 0;
    state[1] = (state[1]! + b) | 0;
    state[2] = (state[2]! + c) | 0;
    state[3] = (state[3]! + d) | 0;
    state[4] = (state[4]! + e) | 0;
    state[5] = (state[5]! + f) | 0;
    state[6] = (state[6]! + g) | 0;
    state[7] = (state[7]! + h) | 0;
  }
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64url(bytes: Uint8Array): string {
  let out = '';
  let at = 0;
  for (; at + 3 <= bytes.length; at += 3) {
    const triple = (bytes[at]! << 16) | (bytes[at + 1]! << 8) | bytes[at + 2]!;
    out += BASE64URL[triple >>> 18]! + BASE64URL[(triple >>> 12) & 63]! + BASE64URL[(triple >>> 6) & 63]! + BASE64URL[triple & 63]!;
  }
  const rest = bytes.length - at;
  if (rest === 1) {
    const single = bytes[at]!;
    out += BASE64URL[single >>> 2]! + BASE64URL[(single & 3) << 4]!;
  } else if (rest === 2) {
    const pair = (bytes[at]! << 8) | bytes[at + 1]!;
    out += BASE64URL[pair >>> 10]! + BASE64URL[(pair >>> 4) & 63]! + BASE64URL[(pair & 15) << 2]!;
  }
  return out;
}

export const sha256 = (): Sha256 => new PortableSha256();

export async function sha256Batch(parts: readonly Uint8Array[]): Promise<readonly string[]> {
  const digests: string[] = [];
  for (const part of parts) {
    const digest = await crypto.subtle.digest('SHA-256', part.slice().buffer);
    digests.push(hex(new Uint8Array(digest)));
  }
  return digests;
}
