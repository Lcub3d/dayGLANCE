import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { sha256, digestShim, installSubtleDigestShim } from './sha256.js';

const hex = (u8) => [...new Uint8Array(u8)].map(b => b.toString(16).padStart(2, '0')).join('');
const native = async (bytes) => hex(await webcrypto.subtle.digest('SHA-256', bytes));

describe('sha256 (pure JS)', () => {
  it('matches the published vectors', () => {
    expect(hex(sha256(new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('is bit-identical to WebCrypto across the padding boundaries', async () => {
    // 55/56/63/64/65 bytes straddle the one-block / two-block padding edge;
    // the rest cover multi-block messages.
    for (const len of [1, 3, 31, 32, 55, 56, 57, 63, 64, 65, 100, 119, 120, 127, 128, 129, 1000, 4096, 10001]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 131 + len * 7) & 0xff;
      expect(hex(sha256(bytes)), `length ${len}`).toBe(await native(bytes));
    }
  });

  it('is bit-identical to WebCrypto on random input', async () => {
    for (let round = 0; round < 50; round++) {
      const bytes = webcrypto.getRandomValues(new Uint8Array(1 + Math.floor(Math.random() * 600)));
      expect(hex(sha256(bytes))).toBe(await native(bytes));
    }
  });

  it('hashes the intents seed strings the GLANCE integration actually uses, including non-ASCII', async () => {
    for (const seed of [
      'app.lastglance|1ef5d326-aa60-41b1-ba76-d942b9f45ca1|2026-10-04',
      'app.lastglance|1ef5d326-aa60-41b1-ba76-d942b9f45ca1',
      '20261004T101346Z-47e96d',
      'Śmieci wynieść — zażółć gęślą jaźń 🧹',
    ]) {
      const bytes = new TextEncoder().encode(seed);
      expect(hex(sha256(bytes))).toBe(await native(bytes));
    }
  });

  it('accepts an ArrayBuffer and a view with a byte offset', async () => {
    const backing = new Uint8Array(40);
    for (let i = 0; i < 40; i++) backing[i] = i;
    const view = new Uint8Array(backing.buffer, 8, 20);
    expect(hex(sha256(backing.buffer))).toBe(await native(backing));
    expect(hex(sha256(view))).toBe(await native(view.slice()));
    expect(hex(sha256(new Uint16Array(backing.buffer, 8, 10)))).toBe(await native(view.slice()));
  });
});

describe('digestShim', () => {
  it('resolves to an ArrayBuffer, like SubtleCrypto.digest', async () => {
    const data = new TextEncoder().encode('abc');
    const out = await digestShim('SHA-256', data);
    expect(out).toBeInstanceOf(ArrayBuffer);
    expect(hex(out)).toBe(await native(data));
    expect(hex(await digestShim({ name: 'sha-256' }, data))).toBe(await native(data));
  });

  it('rejects any other algorithm rather than answering with the wrong hash', async () => {
    await expect(digestShim('SHA-1', new Uint8Array(1))).rejects.toThrow(/SHA-1/);
    await expect(digestShim({ name: 'SHA-512' }, new Uint8Array(1))).rejects.toThrow(/SHA-512/);
    await expect(digestShim(undefined, new Uint8Array(1))).rejects.toThrow(/unknown/);
  });
});

describe('installSubtleDigestShim', () => {
  it('leaves a real WebCrypto alone', () => {
    const subtle = webcrypto.subtle;
    const fake = { subtle, getRandomValues: () => {} };
    expect(installSubtleDigestShim(fake)).toBe(false);
    expect(fake.subtle).toBe(subtle);
  });

  it('installs a digest-only subtle when none is present (insecure context)', async () => {
    const fake = { getRandomValues: () => {} };
    expect(installSubtleDigestShim(fake)).toBe(true);
    const data = new TextEncoder().encode('abc');
    expect(hex(await fake.subtle.digest('SHA-256', data))).toBe(await native(data));
    // Nothing else is pretended: key handling stays unavailable, loudly.
    expect(fake.subtle.encrypt).toBeUndefined();
    expect(fake.subtle.importKey).toBeUndefined();
    // Idempotent.
    expect(installSubtleDigestShim(fake)).toBe(false);
  });

  it('tolerates a missing crypto object', () => {
    expect(installSubtleDigestShim(undefined)).toBe(false);
  });
});
