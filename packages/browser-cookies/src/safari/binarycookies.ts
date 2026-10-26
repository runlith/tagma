import type { Cookie, Reading, SameSite } from '../cookie.js';

const MAGIC = 'cook';
const PAGE_MAGIC = 0x00000100;
const MAC_EPOCH = 978_307_200;
const RECORD_HEAD = 48;
const SECURE = 0x1;
const HTTP_ONLY = 0x4;

const SAME_SITE: Readonly<Record<number, SameSite>> = { 4: 'None', 5: 'Lax', 7: 'Strict' };

export const safariSameSite = (flags: number): SameSite | null => SAME_SITE[(flags >> 3) & 0x7] ?? null;

const text = (record: Buffer, offset: number, end: number): string | null => {
  if (offset < RECORD_HEAD || offset >= end) return null;
  const stop = record.indexOf(0, offset);
  return stop < 0 || stop >= end ? null : record.toString('utf8', offset, stop);
};

const cookieOf = (record: Buffer): Cookie | null => {
  if (record.length < RECORD_HEAD) return null;
  const end = Math.min(record.readUInt32LE(0), record.length);
  if (end < RECORD_HEAD) return null;
  const flags = record.readUInt32LE(8);
  const domain = text(record, record.readUInt32LE(16), end);
  const name = text(record, record.readUInt32LE(20), end);
  if (domain === null || domain === '' || name === null) return null;
  const expiry = record.readDoubleLE(40);
  const secure = (flags & SECURE) !== 0;
  return {
    name,
    value: text(record, record.readUInt32LE(28), end) ?? '',
    domain,
    path: text(record, record.readUInt32LE(24), end) || '/',
    expires: expiry > 0 ? expiry + MAC_EPOCH : null,
    secure,
    httpOnly: (flags & HTTP_ONLY) !== 0,
    sameSite: safariSameSite(flags),
    partitionKey: null,
    priority: null,
    scheme: null,
    port: null,
  };
};

export const parseBinaryCookies = (file: Buffer): Reading => {
  if (file.length < 8 || file.toString('latin1', 0, 4) !== MAGIC) throw new Error('the file is not a binarycookies file');
  const pages = file.readUInt32BE(4);
  if (8 + pages * 4 > file.length) throw new Error('the page table runs past the end of the file');
  const cookies: Cookie[] = [];
  let unreadable = 0;
  let at = 8 + pages * 4;
  for (let index = 0; index < pages; index += 1) {
    const size = file.readUInt32BE(8 + index * 4);
    const page = file.subarray(at, at + size);
    at += size;
    if (page.length < 8 || page.readUInt32BE(0) !== PAGE_MAGIC) throw new Error(`page ${index} carries no page header`);
    const count = page.readUInt32LE(4);
    if (8 + count * 4 > page.length) throw new Error(`the cookie table of page ${index} runs past its end`);
    for (let slot = 0; slot < count; slot += 1) {
      const cookie = cookieOf(page.subarray(page.readUInt32LE(8 + slot * 4)));
      if (cookie === null) unreadable += 1;
      else cookies.push(cookie);
    }
  }
  return { cookies, unreadable };
};
