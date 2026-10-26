import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseCookieString, serializeCookie } from './cookies.js';
import { browserPlatform } from './Platform/browser.js';

type CookieDoc = { cookie: string };
type GlobalRecord = Record<string, unknown>;

function getGlobalRecord(): GlobalRecord {
  return globalThis as unknown as GlobalRecord;
}

class TestCookieDocument implements CookieDoc {
  private readonly store = new Map<string, { value: string; expiresAtMs?: number }>();

  constructor(private readonly now: () => number) {}

  get cookie(): string {
    const nowMs = this.now();
    const parts: string[] = [];

    for (const [name, entry] of this.store.entries()) {
      if (entry.expiresAtMs !== undefined && entry.expiresAtMs <= nowMs) {
        this.store.delete(name);
        continue;
      }
      parts.push(`${name}=${entry.value}`);
    }

    return parts.join('; ');
  }

  set cookie(cookieString: string) {
    const segments = cookieString
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) return;

    const [nameValue, ...attrs] = segments;
    if (nameValue === undefined) return;
    const eqIndex = nameValue.indexOf('=');
    if (eqIndex === -1) return;

    const name = nameValue.slice(0, eqIndex).trim();
    const value = nameValue.slice(eqIndex + 1).trim();
    if (!name) return;

    const parsedAttrs = new Map<string, string | true>();
    for (const attr of attrs) {
      const idx = attr.indexOf('=');
      if (idx === -1) {
        parsedAttrs.set(attr.toLowerCase(), true);
        continue;
      }
      parsedAttrs.set(attr.slice(0, idx).toLowerCase(), attr.slice(idx + 1));
    }

    const maxAgeRaw = parsedAttrs.get('max-age');
    if (typeof maxAgeRaw === 'string') {
      const maxAge = Number.parseInt(maxAgeRaw, 10);
      if (Number.isFinite(maxAge) && maxAge <= 0) {
        this.store.delete(name);
        return;
      }
    }

    const expiresRaw = parsedAttrs.get('expires');
    if (typeof expiresRaw === 'string') {
      const expiresAtMs = Date.parse(expiresRaw);
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= this.now()) {
        this.store.delete(name);
        return;
      }
    }

    this.store.set(name, { value });
  }
}

describe('the cookie a document is spelled with', () => {
  it('parses a cookie string and decodes its values', () => {
    expect(parseCookieString('a=1; b=two%20words; c=3%3D4')).toEqual({ a: '1', b: 'two words', c: '3=4' });
  });

  it('serializes with the defaults every caller relies on, and encodes the value', () => {
    const serialized = serializeCookie('token', 'two words');
    expect(serialized).toContain('token=two%20words');
    expect(serialized).toContain('Path=/');
    expect(serialized).toContain('SameSite=Lax');
  });

  it('refuses SameSite=None without Secure, which Chrome would drop', () => {
    expect(() => serializeCookie('a', '1', { sameSite: 'none' })).toThrow(/SameSite=None/i);
  });

  it('holds every invariant the __Host- prefix carries', () => {
    expect(() => serializeCookie('__Host-a', '1', { secure: true, path: '/', sameSite: 'lax' })).not.toThrow();
    expect(() => serializeCookie('__Host-a', '1', { secure: false })).toThrow(/__Host-/i);
    expect(() => serializeCookie('__Host-a', '1', { secure: true, domain: 'example.com' })).toThrow(/domain/i);
    expect(() => serializeCookie('__Host-a', '1', { secure: true, path: '/x' })).toThrow(/path/i);
  });
});

describe("the browser's cookie door", () => {
  const globalRecord = getGlobalRecord();
  const prevDocument = globalRecord.document;
  const prevLocation = globalRecord.location;

  beforeEach(() => {
    globalRecord.document = new TestCookieDocument(() => Date.now()) as unknown as CookieDoc;
    globalRecord.location = { protocol: 'https:' } as unknown;
  });

  afterEach(() => {
    if (prevDocument === undefined) delete globalRecord.document;
    else globalRecord.document = prevDocument;

    if (prevLocation === undefined) delete globalRecord.location;
    else globalRecord.location = prevLocation;
  });

  it('writes and reads back through the document', () => {
    const cookies = browserPlatform().cookies;
    cookies.set('session_access-token', 'abc123');
    expect(cookies.get('session_access-token')).toBe('abc123');
  });

  it('deletes what it wrote', () => {
    const cookies = browserPlatform().cookies;
    cookies.set('x', 'y');
    cookies.delete('x');
    expect(cookies.get('x')).toBeUndefined();
  });

  it('refuses a secure cookie on http, where the browser would silently drop it', () => {
    globalRecord.location = { protocol: 'http:' } as unknown;
    expect(() => browserPlatform().cookies.set('x', 'y', { secure: true })).toThrow(/https/i);
  });
});
