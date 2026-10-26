import { Database } from 'bun:sqlite';
import { expect } from 'bun:test';
import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { makeChromiumSources } from './chromium/chromium.js';
import type { Cookie } from './cookie.js';
import { readCookieFile } from './file/file.js';
import { makeFirefoxSource } from './firefox/firefox.js';
import { makeSafariSource } from './safari/safari.js';
import { KeyUnavailable, SafeStorageKey } from './source.js';

const PASSWORD = 'synthetic-fixture-password';
const EPOCH_GAP = 11_644_473_600;
const EXPIRES = 2_000_000_000;

const home = mkdtempSync(join(tmpdir(), 'browser-cookies-home-'));
const support = join(home, 'Library', 'Application Support');

const sealed = (value: string, host: string, hashed: boolean, tag = 'v10'): Buffer => {
  const key = pbkdf2Sync(PASSWORD, 'saltysalt', 1003, 16, 'sha1');
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
  const plain = Buffer.concat([hashed ? createHash('sha256').update(host).digest() : Buffer.alloc(0), Buffer.from(value)]);
  return Buffer.concat([Buffer.from(tag), cipher.update(plain), cipher.final()]);
};

type ChromiumRow = {
  readonly host: string;
  readonly name: string;
  readonly plain?: string;
  readonly sealed?: Buffer;
  readonly samesite: number;
  readonly site?: string;
  readonly ancestor?: number;
};

const chromiumProfile = (folder: string, version: number, rows: readonly ChromiumRow[]) => {
  const dir = join(support, 'Google', 'Chrome', folder, 'Network');
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'Cookies'));
  db.run('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
  db.run("INSERT INTO meta VALUES ('version', ?)", [String(version)]);
  db.run(
    'CREATE TABLE cookies (host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, priority INTEGER, samesite INTEGER, source_scheme INTEGER, source_port INTEGER, has_cross_site_ancestor INTEGER)',
  );
  for (const row of rows) {
    db.run('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      row.host,
      row.site ?? '',
      row.name,
      row.plain ?? '',
      row.sealed ?? Buffer.alloc(0),
      '/',
      (EXPIRES + EPOCH_GAP) * 1_000_000,
      1,
      0,
      1,
      row.samesite,
      2,
      443,
      row.ancestor ?? 0,
    ]);
  }
  db.close();
};

chromiumProfile('Default', 24, [
  { host: '.example.com', name: 'sid', sealed: sealed('secret-1', '.example.com', true), samesite: 0 },
  { host: 'app.example.com', name: 'lax', sealed: sealed('secret-2', 'app.example.com', true, 'v11'), samesite: 1 },
  { host: '.example.com', name: 'strict', sealed: sealed('', '.example.com', true), samesite: 2 },
  { host: '.example.com', name: 'unset', plain: 'plain', samesite: -1 },
  { host: '.example.com', name: 'bound', sealed: Buffer.from('v20 app-bound bytes'), samesite: 0 },
  {
    host: 'embed.example.net',
    name: 'chip',
    sealed: sealed('c', 'embed.example.net', true),
    samesite: 0,
    site: 'https://top.example',
    ancestor: 1,
  },
]);
chromiumProfile('Profile 1', 23, [{ host: '.old.example', name: 'raw', sealed: sealed('kept', '.old.example', true), samesite: 3 }]);
writeFileSync(
  join(support, 'Google', 'Chrome', 'Local State'),
  JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' }, 'Profile 1': { name: 'Work' } } } }),
);

const firefoxDir = join(support, 'Firefox', 'Profiles', 'abc.default-release');
mkdirSync(firefoxDir, { recursive: true });
writeFileSync(
  join(support, 'Firefox', 'profiles.ini'),
  '[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abc.default-release\n',
);
const firefoxWriter = new Database(join(firefoxDir, 'cookies.sqlite'));
{
  const db = firefoxWriter;
  db.query('PRAGMA journal_mode = WAL').get();
  db.run('PRAGMA wal_autocheckpoint = 0');
  db.run(
    'CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT, name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, isPartitionedAttributeSet INTEGER)',
  );
  const rows: readonly [string, string, number, number, number][] = [
    ['', 'none', 0, 1, EXPIRES * 1000],
    ['', 'legacy', 0, 0, EXPIRES],
    ['', 'lax', 1, 0, EXPIRES],
    ['', 'strict', 2, 1, EXPIRES],
    ['', 'unset', 256, 0, EXPIRES],
    ['^userContextId=2', 'contained', 1, 0, EXPIRES],
  ];
  for (const [origin, name, sameSite, secure, expiry] of rows)
    db.run(
      'INSERT INTO moz_cookies (originAttributes, name, value, host, path, expiry, isSecure, isHttpOnly, sameSite, isPartitionedAttributeSet) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0)',
      [origin, name, `${name}-value`, '.fox.example', '/', expiry, secure, sameSite],
    );
}

const binaryCookies = (records: readonly { readonly name: string; readonly flags: number }[]): Buffer => {
  const bodies = records.map(({ name, flags }) => {
    const strings = ['.safari.example', name, '/', `${name}-value`].map((text) => Buffer.from(`${text}\0`));
    const head = Buffer.alloc(56);
    let at = 56;
    const offsets = strings.map((held) => {
      const offset = at;
      at += held.length;
      return offset;
    });
    head.writeUInt32LE(at, 0);
    head.writeUInt32LE(flags, 8);
    head.writeUInt32LE(offsets[0]!, 16);
    head.writeUInt32LE(offsets[1]!, 20);
    head.writeUInt32LE(offsets[2]!, 24);
    head.writeUInt32LE(offsets[3]!, 28);
    head.writeDoubleLE(EXPIRES - 978_307_200, 40);
    return Buffer.concat([head, ...strings]);
  });
  const table = Buffer.alloc(8 + bodies.length * 4 + 4);
  table.writeUInt32BE(0x100, 0);
  table.writeUInt32LE(bodies.length, 4);
  let at = table.length;
  bodies.forEach((body, index) => {
    table.writeUInt32LE(at, 8 + index * 4);
    at += body.length;
  });
  const page = Buffer.concat([table, ...bodies]);
  const head = Buffer.alloc(12);
  head.write('cook', 0, 'latin1');
  head.writeUInt32BE(1, 4);
  head.writeUInt32BE(page.length, 8);
  return Buffer.concat([head, page, Buffer.alloc(8)]);
};

const safariDir = join(home, 'Library', 'Containers', 'com.apple.Safari', 'Data', 'Library', 'Cookies');
mkdirSync(safariDir, { recursive: true });
writeFileSync(
  join(safariDir, 'Cookies.binarycookies'),
  binaryCookies([
    { name: 'lax', flags: 0x28 | 0x1 },
    { name: 'strict', flags: 0x38 | 0x4 },
    { name: 'none', flags: 0x20 | 0x1 | 0x4 },
    { name: 'unset', flags: 0 },
  ]),
);

const keys = Layer.succeed(
  SafeStorageKey,
  SafeStorageKey.of({
    read: (service, account) =>
      service === 'Chrome Safe Storage' && account === 'Chrome'
        ? Effect.succeed(PASSWORD)
        : Effect.fail(new KeyUnavailable({ reason: 'missing', message: `no ${service}` })),
  }),
);

const brief = (cookies: readonly Cookie[]) =>
  cookies.map((cookie) => ({ domain: cookie.domain, name: cookie.name, value: cookie.value, sameSite: cookie.sameSite }));

it.live('a Chromium database of version 24 decrypts v10 and v11 values without their domain hash and names v20 values unreadable', () =>
  Effect.gen(function* () {
    const sources = yield* makeChromiumSources({ home });
    const chrome = sources.find((source) => source.id === 'chrome')!;
    expect(yield* chrome.profiles).toEqual([
      { id: 'Default', name: 'Person 1' },
      { id: 'Profile 1', name: 'Work' },
    ]);
    const read = yield* chrome.read('Default');
    expect(read.unreadable).toBe(1);
    expect(brief(read.cookies)).toEqual([
      { domain: '.example.com', name: 'sid', value: 'secret-1', sameSite: 'None' },
      { domain: 'app.example.com', name: 'lax', value: 'secret-2', sameSite: 'Lax' },
      { domain: '.example.com', name: 'strict', value: '', sameSite: 'Strict' },
      { domain: '.example.com', name: 'unset', value: 'plain', sameSite: null },
      { domain: 'embed.example.net', name: 'chip', value: 'c', sameSite: 'None' },
    ]);
    expect(read.cookies.find((cookie) => cookie.name === 'chip')?.partitionKey).toEqual({
      topLevelSite: 'https://top.example',
      hasCrossSiteAncestor: true,
    });
    expect(Math.round(read.cookies[0]!.expires!)).toBe(EXPIRES);
    const old = yield* chrome.read('Profile 1');
    expect(old.cookies[0]!.value.endsWith('kept')).toBe(true);
    expect(old.cookies[0]!.value).not.toBe('kept');
    expect(old.cookies[0]!.sameSite).toBeNull();
  }).pipe(Effect.provide(Layer.merge(BunFileSystem.layer, keys))),
);

it.live(
  'Firefox, read while its writer holds rows only in the WAL, and Safari decode SameSite by their own numbering; Firefox skips container rows',
  () =>
    Effect.gen(function* () {
      expect(statSync(join(firefoxDir, 'cookies.sqlite-wal')).size).toBeGreaterThan(0);
      const firefox = yield* makeFirefoxSource({ home });
      const [profile] = yield* firefox.profiles;
      const fox = yield* firefox.read(profile!.id);
      expect(fox.unreadable).toBe(1);
      expect(fox.cookies.map((cookie) => [cookie.name, cookie.sameSite, cookie.expires])).toEqual([
        ['none', 'None', EXPIRES],
        ['legacy', null, EXPIRES],
        ['lax', 'Lax', EXPIRES],
        ['strict', 'Strict', EXPIRES],
        ['unset', null, EXPIRES],
      ]);
      firefoxWriter.close();
      const source = yield* makeSafariSource({ home });
      expect(yield* source.profiles).toEqual([{ id: 'default', name: 'Safari' }]);
      expect(yield* (yield* makeSafariSource({ home: join(home, 'nobody') })).profiles).toEqual([]);
      const safari = yield* source.read('default');
      expect(
        safari.cookies.map((cookie) => [cookie.name, cookie.value, cookie.sameSite, cookie.secure, cookie.httpOnly, cookie.expires]),
      ).toEqual([
        ['lax', 'lax-value', 'Lax', true, false, EXPIRES],
        ['strict', 'strict-value', 'Strict', false, true, EXPIRES],
        ['none', 'none-value', 'None', true, true, EXPIRES],
        ['unset', 'unset-value', null, false, false, EXPIRES],
      ]);
    }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('a cookie export file keeps host-only cookies host-only and counts entries it cannot read', () =>
  Effect.gen(function* () {
    const file = join(home, 'export.json');
    writeFileSync(
      file,
      JSON.stringify([
        {
          domain: 'host.example',
          hostOnly: true,
          name: 'h',
          value: '1',
          path: '/',
          secure: true,
          sameSite: 'no_restriction',
          expirationDate: EXPIRES,
        },
        { domain: '.example.org', hostOnly: false, name: 'd', value: '', sameSite: 'unspecified', session: true },
        { domain: '.example.org', name: 7 },
      ]),
    );
    const read = yield* readCookieFile(file);
    expect(read.unreadable).toBe(1);
    expect(read.cookies.map((cookie) => [cookie.domain, cookie.name, cookie.value, cookie.sameSite, cookie.expires])).toEqual([
      ['host.example', 'h', '1', 'None', EXPIRES],
      ['.example.org', 'd', '', null, null],
    ]);
  }),
);
