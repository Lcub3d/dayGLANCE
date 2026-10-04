// SHA-256 for browsers that hide WebCrypto.
//
// `crypto.subtle` is [SecureContext]-only: served over plain HTTP on a LAN
// address (a self-hosted dayGLANCE on 192.168.x.x), it is simply undefined, and
// every `crypto.subtle.digest(...)` throws "Cannot read properties of undefined
// (reading 'digest')". The GLANCE integration hashes on every inbound create
// (`createKey` in @glance-apps/intents, then `deterministicTaskId`), so a chore
// sent from lastGLANCE lands in the activity log as that error (#1968).
//
// The deterministic ids those hashes feed are the whole point of hashing: two
// devices must derive the SAME id from the same seed, or the sync engine keeps
// both copies. So the fallback is a real SHA-256 that is bit-identical to
// WebCrypto's, verified against it in sha256.test.js, not a cheaper hash.
//
// `installSubtleDigestShim` (called from main.jsx next to the randomUUID
// polyfill) provides ONLY `digest`. Encryption (vault end-to-end, intents
// envelopes, HMAC reviewer codes) stays unavailable in an insecure context and
// fails with "... is not a function" at its own call site, which is the honest
// outcome: a hash can be reimplemented safely, key material handling should not
// be.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('sha256: data must be an ArrayBuffer or an ArrayBuffer view');
}

/**
 * SHA-256 of `data` (ArrayBuffer or any typed-array view), synchronously.
 * Returns a 32-byte Uint8Array. Bit-identical to WebCrypto's SHA-256.
 */
export function sha256(data) {
  const msg = toBytes(data);
  const bitLen = msg.length * 8;
  // Pad: 0x80, zeros to 56 mod 64, then the 64-bit big-endian bit length.
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  // Messages here are far below 2^32 bytes, but write both halves regardless.
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = view.getUint32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const w15 = W[t - 15], w2 = W[t - 2];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }

    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const T1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const T2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + T1) >>> 0;
      d = c; c = b; b = a; a = (T1 + T2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, H[i]);
  return out;
}

function algorithmName(algorithm) {
  const name = typeof algorithm === 'string' ? algorithm : algorithm?.name;
  return typeof name === 'string' ? name.toUpperCase() : '';
}

/**
 * A `SubtleCrypto.digest`-shaped function backed by `sha256`. Resolves to an
 * ArrayBuffer like the real one so callers wrapping it in `new Uint8Array(...)`
 * see no difference. Only SHA-256 is offered; nothing in the GLANCE apps hashes
 * with anything else, and a silent wrong-algorithm answer would be worse than
 * the rejection.
 */
export async function digestShim(algorithm, data) {
  if (algorithmName(algorithm) !== 'SHA-256') {
    throw new Error(`crypto.subtle.digest: ${algorithmName(algorithm) || 'unknown'} is not available outside a secure context (only SHA-256 is shimmed)`);
  }
  return sha256(data).buffer;
}

/**
 * When `cryptoObj.subtle` is absent (insecure context), define a minimal
 * `subtle` exposing `digest` only. No-op when real WebCrypto is present, so
 * secure contexts keep the native implementation. Returns true when the shim
 * was installed.
 */
export function installSubtleDigestShim(cryptoObj = globalThis.crypto) {
  if (!cryptoObj || cryptoObj.subtle) return false;
  try {
    Object.defineProperty(cryptoObj, 'subtle', {
      value: { digest: digestShim },
      configurable: true,
      writable: true,
      enumerable: false,
    });
    return true;
  } catch {
    return false;
  }
}
