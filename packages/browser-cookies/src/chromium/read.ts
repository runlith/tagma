import type { Database } from 'bun:sqlite';
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { type Cookie, type PartitionKey, type Priority, type Reading, type SameSite, type Scheme, siteOf } from '../cookie.js';
import { columnsOf, flag, snapshotted } from '../snapshot.js';

export type ChromiumAsk = { readonly file: string; readonly password: string | null };

const SALT = 'saltysalt';
const ROUNDS = 1003;
const KEY_BYTES = 16;
const IV = Buffer.alloc(16, ' ');
const HASHED_FROM = 24;
const HASH_BYTES = 32;
const EPOCH_GAP = 11_644_473_600;

const SAME_SITE: Readonly<Record<number, SameSite>> = { 0: 'None', 1: 'Lax', 2: 'Strict' };
const PRIORITY: Readonly<Record<number, Priority>> = { 0: 'Low', 1: 'Medium', 2: 'High' };
const SCHEME: Readonly<Record<number, Scheme>> = { 0: 'Unset', 1: 'NonSecure', 2: 'Secure' };

type Row = {
  readonly host_key: string;
  readonly name: string;
  readonly value: string;
  readonly encrypted_value: Uint8Array | null;
  readonly path: string;
  readonly expires_utc: number;
  readonly is_secure: number;
  readonly is_httponly: number;
  readonly samesite: number;
  readonly priority: number | null;
  readonly source_scheme: number | null;
  readonly source_port: number | null;
  readonly top_frame_site_key: string | null;
  readonly has_cross_site_ancestor: unknown;
};

export const chromiumKey = (password: string): Buffer => pbkdf2Sync(password, SALT, ROUNDS, KEY_BYTES, 'sha1');

export const decrypted = (sealed: Uint8Array, key: Buffer | null, host: string, hashed: boolean): string | null => {
  const tag = Buffer.from(sealed.subarray(0, 3)).toString('latin1');
  if ((tag !== 'v10' && tag !== 'v11') || key === null || sealed.length <= 3) return null;
  let plain: Buffer;
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, IV);
    plain = Buffer.concat([decipher.update(sealed.subarray(3)), decipher.final()]);
  } catch {
    return null;
  }
  const prefixed = hashed && plain.length >= HASH_BYTES && plain.subarray(0, HASH_BYTES).equals(createHash('sha256').update(host).digest());
  return (prefixed ? plain.subarray(HASH_BYTES) : plain).toString('utf8');
};

const versionOf = (db: Database): number => {
  const row = db.query<{ readonly value: string }, []>("SELECT value FROM meta WHERE key = 'version'").get();
  return row === null ? 0 : Number(row.value);
};

const partitionOf = (row: Row, columns: ReadonlySet<string>): PartitionKey | null | undefined => {
  if (!columns.has('top_frame_site_key') || row.top_frame_site_key === null || row.top_frame_site_key === '') return null;
  const site = siteOf(row.top_frame_site_key);
  const ancestor = columns.has('has_cross_site_ancestor') ? flag(row.has_cross_site_ancestor) : null;
  return site === null || ancestor === null ? undefined : { topLevelSite: site, hasCrossSiteAncestor: ancestor };
};

export const readChromium = (ask: ChromiumAsk): Reading =>
  snapshotted(ask.file, (db) => {
    const hashed = versionOf(db) >= HASHED_FROM;
    const columns = columnsOf(db, 'cookies');
    const optional = (name: string, fallback: string) => (columns.has(name) ? name : `${fallback} AS ${name}`);
    const rows = db
      .query<Row, []>(
        `SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite, ${optional('priority', 'NULL')}, ${optional('source_scheme', 'NULL')}, ${optional('source_port', 'NULL')}, ${optional('top_frame_site_key', 'NULL')}, ${optional('has_cross_site_ancestor', 'NULL')} FROM cookies`,
      )
      .all();
    const key = ask.password === null ? null : chromiumKey(ask.password);
    const cookies: Cookie[] = [];
    let unreadable = 0;
    for (const row of rows) {
      const sealed = row.encrypted_value;
      const value = row.value !== '' || sealed === null || sealed.length === 0 ? row.value : decrypted(sealed, key, row.host_key, hashed);
      const partitionKey = partitionOf(row, columns);
      if (value === null || partitionKey === undefined) {
        unreadable += 1;
        continue;
      }
      cookies.push({
        name: row.name,
        value,
        domain: row.host_key,
        path: row.path || '/',
        expires: row.expires_utc === 0 ? null : row.expires_utc / 1_000_000 - EPOCH_GAP,
        secure: row.is_secure === 1,
        httpOnly: row.is_httponly === 1,
        sameSite: SAME_SITE[row.samesite] ?? null,
        partitionKey,
        priority: row.priority === null ? null : (PRIORITY[row.priority] ?? null),
        scheme: row.source_scheme === null ? null : (SCHEME[row.source_scheme] ?? null),
        port: row.source_port === null || row.source_port < 0 ? null : row.source_port,
      });
    }
    return { cookies, unreadable };
  });
