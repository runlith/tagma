import { describe, expect, test } from 'bun:test';
import { CRC32_INITIAL, crc32Final, crc32Update } from './recordFormat';

const reference = (bytes: Uint8Array): number => {
  let crc = CRC32_INITIAL;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index] as number;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
};

const fold = (bytes: Uint8Array): number => crc32Final(crc32Update(CRC32_INITIAL, bytes));

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('crc32', () => {
  test('answers the universal check value', () => {
    expect(fold(bytes('123456789'))).toBe(0xcbf43926);
  });

  test('an empty payload leaves the register it was given', () => {
    expect(crc32Update(CRC32_INITIAL, new Uint8Array(0))).toBe(CRC32_INITIAL);
    expect(fold(new Uint8Array(0))).toBe(0);
  });

  test('folding in two carries is folding once', () => {
    const payload = bytes(`\x1b[38;5;196m12345\x1b[0m h\xc3\xa9llo w\xc3\xb6rld \xe2\x9c\x93\r\n`.repeat(200));
    const cut = 1000;
    const carried = crc32Update(crc32Update(CRC32_INITIAL, payload.subarray(0, cut)), payload.subarray(cut));
    expect(crc32Final(carried)).toBe(fold(payload));
  });

  test('matches the table-free fold over every byte value', () => {
    const payload = new Uint8Array(1024);
    for (let index = 0; index < payload.length; index += 1) payload[index] = index % 256;
    expect(crc32Update(CRC32_INITIAL, payload)).toBe(reference(payload));
  });

  test('matches the table-free fold over 64 KiB of terminal-like output', () => {
    const payload = bytes('gcc -O2 -o runlith main.c \xe2\x9c\x93 $ make -j6 \x1b[2K\x1b[1A\r\n'.repeat(1024));
    expect(crc32Update(CRC32_INITIAL, payload)).toBe(reference(payload));
  });
});
