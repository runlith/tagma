import type { Cookie, Reading, SameSite } from '../cookie.js';
import { columnsOf, flag, snapshotted } from '../snapshot.js';

const MILLIS_FROM = 100_000_000_000;

type Row = {
  readonly name: string;
  readonly value: string | null;
  readonly host: string;
  readonly path: string | null;
  readonly expiry: number;
  readonly isSecure: number;
  readonly isHttpOnly: number;
  readonly sameSite: number | null;
  readonly originAttributes: string | null;
  readonly isPartitionedAttributeSet: unknown;
};

export const firefoxSameSite = (raw: number | null, secure: boolean): SameSite | null => {
  switch (raw) {
    case 0:
      return secure ? 'None' : null;
    case 1:
      return 'Lax';
    case 2:
      return 'Strict';
    default:
      return null;
  }
};

export const readFirefox = (file: string): Reading =>
  snapshotted(file, (db) => {
    const columns = columnsOf(db, 'moz_cookies');
    const optional = (name: string) => (columns.has(name) ? name : `NULL AS ${name}`);
    const rows = db
      .query<Row, []>(
        `SELECT name, value, host, path, expiry, isSecure, isHttpOnly, ${optional('sameSite')}, ${optional('originAttributes')}, ${optional('isPartitionedAttributeSet')} FROM moz_cookies`,
      )
      .all();
    const cookies: Cookie[] = [];
    let unreadable = 0;
    for (const row of rows) {
      if ((row.originAttributes ?? '') !== '' || flag(row.isPartitionedAttributeSet) === true || row.host === '') {
        unreadable += 1;
        continue;
      }
      const secure = row.isSecure === 1;
      cookies.push({
        name: row.name,
        value: row.value ?? '',
        domain: row.host,
        path: row.path || '/',
        expires: row.expiry > 0 ? (row.expiry >= MILLIS_FROM ? row.expiry / 1000 : row.expiry) : null,
        secure,
        httpOnly: row.isHttpOnly === 1,
        sameSite: firefoxSameSite(row.sameSite, secure),
        partitionKey: null,
        priority: null,
        scheme: null,
        port: null,
      });
    }
    return { cookies, unreadable };
  });
