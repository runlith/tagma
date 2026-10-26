import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { openQueryOnly } from '../../platform/store/queryOnly.js';
import { MIRROR_IDENTITY, mirrorIdentitySchema } from '../contract/wire/storage.js';
import type { IdentityRequest, MirrorCopy, MirrorInspection, UnreadMirror } from './identity.js';

declare const self: Worker;

const identityOf = Schema.decodeUnknownSync(Schema.fromJsonString(mirrorIdentitySchema));

self.onmessage = (event: MessageEvent<IdentityRequest>) => {
  const { home, path: one, baseline, rename } = event.data;
  const copies: MirrorCopy[] = [];
  const unread: UnreadMirror[] = [];
  const inspect = (path: string): void => {
    try {
      const db = openQueryOnly(path);
      try {
        if (db.query("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get() === null) return;
        const reached = db.query('select 1 from __drizzle_migrations where name = ? limit 1').get(baseline);
        if (reached === null) return;
        const row = db.query<{ value: string }, [string]>('select value from meta where key = ?').get(MIRROR_IDENTITY);
        if (row === null) return;
        let identity = identityOf(row.value);
        if (rename !== undefined && identity.projectId === rename.projectId && identity.branch === rename.from) {
          identity = { ...identity, branch: rename.to };
          db.run('PRAGMA query_only = OFF');
          db.query('update meta set value = ? where key = ? and value = ?').run(JSON.stringify(identity), MIRROR_IDENTITY, row.value);
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
  else if (home !== undefined) {
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
