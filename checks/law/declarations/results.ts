import { createHash } from 'node:crypto';
import type { Finding } from '@runlith/tagma/rules';
import { databaseAt } from './database';

const KEPT = 6;

export const familyOf = (kind: string, params: object): string =>
  `${kind}/${createHash('sha1').update(JSON.stringify(params)).digest('hex').slice(0, 16)}`;

export const resultAt = (root: string, family: string, tree: string): readonly Finding[] | undefined => {
  const row = databaseAt(root).query<{ value: string }, [string]>('SELECT value FROM results WHERE key = ?').get(`${family}/${tree}`);
  return row === null ? undefined : (JSON.parse(row.value) as readonly Finding[]);
};

export const carryResult = (root: string, family: string, from: string, to: string): void => {
  const database = databaseAt(root);
  database
    .query('INSERT OR REPLACE INTO results (family, key, value, at) SELECT family, ?, value, ? FROM results WHERE key = ?')
    .run(`${family}/${to}`, Date.now(), `${family}/${from}`);
};

export const saveResult = (root: string, family: string, tree: string, findings: readonly Finding[]): void => {
  const database = databaseAt(root);
  database.transaction(() => {
    database
      .query('INSERT OR REPLACE INTO results (family, key, value, at) VALUES (?, ?, ?, ?)')
      .run(family, `${family}/${tree}`, JSON.stringify(findings), Date.now());
    database
      .query('DELETE FROM results WHERE family = ? AND key NOT IN (SELECT key FROM results WHERE family = ? ORDER BY at DESC LIMIT ?)')
      .run(family, family, KEPT);
  })();
};
