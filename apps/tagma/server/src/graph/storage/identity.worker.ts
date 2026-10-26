import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { relocatedPath } from '../../platform/contract/service/relocation.js';
import { openQueryOnly } from '../../platform/store/queryOnly.js';
import { MIRROR_IDENTITY, mirrorIdentitySchema, TREE_BASIS, type MirrorIdentity } from '../contract/wire/storage.js';
import type { IdentityRequest, MirrorCopy, MirrorInspection, UnreadMirror } from './identity.js';

declare const self: Worker;

const identityOf = Schema.decodeUnknownSync(Schema.fromJsonString(mirrorIdentitySchema));

self.onmessage = (event: MessageEvent<IdentityRequest>) => {
  const { home, path: one, paths, baseline, rename, relocate } = event.data;
  const copies: MirrorCopy[] = [];
  const unread: UnreadMirror[] = [];
  const moved = (identity: MirrorIdentity): MirrorIdentity => {
    if (relocate === undefined) return identity;
    const treeRoot = relocatedPath(identity.treeRoot, relocate) ?? identity.treeRoot;
    const gitDir = identity.gitDir === null ? null : (relocatedPath(identity.gitDir, relocate) ?? identity.gitDir);
    return treeRoot === identity.treeRoot && gitDir === identity.gitDir ? identity : { ...identity, treeRoot, gitDir };
  };
  const inspect = (path: string): void => {
    try {
      const db = openQueryOnly(path);
      try {
        if (db.query("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get() === null) return;
        if (baseline !== null && db.query('select 1 from __drizzle_migrations where name = ? limit 1').get(baseline) === null) return;
        if (db.query("select 1 from sqlite_master where type = 'table' and name = 'meta'").get() === null) return;
        const row = db.query<{ value: string }, [string]>('select value from meta where key = ?').get(MIRROR_IDENTITY);
        if (row === null) return;
        const read = identityOf(row.value);
        const renamed =
          rename !== undefined && read.projectId === rename.projectId && read.branch === rename.from
            ? { ...read, branch: rename.to }
            : read;
        const identity = moved(renamed);
        if (identity !== read) {
          db.run('PRAGMA query_only = OFF');
          db.transaction(() => {
            db.query('update meta set value = ? where key = ? and value = ?').run(JSON.stringify(identity), MIRROR_IDENTITY, row.value);
            if (identity.treeRoot !== renamed.treeRoot) db.query('delete from meta where key = ?').run(TREE_BASIS);
          })();
        }
        copies.push({ path, identity });
      } finally {
        db.close();
      }
    } catch (cause) {
      unread.push({ path, reason: String(cause) });
    }
  };
  if (one !== undefined) inspect(one);
  for (const path of paths ?? []) inspect(path);
  if (home !== undefined) {
    try {
      for (const directory of readdirSync(home, { withFileTypes: true })) {
        if (!directory.isDirectory()) continue;
        const root = join(home, directory.name);
        for (const file of readdirSync(root, { withFileTypes: true })) {
          if (file.isFile() && file.name.endsWith('.sqlite')) inspect(join(root, file.name));
        }
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') unread.push({ path: home, reason: String(cause) });
    }
  }
  self.postMessage({ copies, unread } satisfies MirrorInspection);
};

self.postMessage({ state: 'ready' });
