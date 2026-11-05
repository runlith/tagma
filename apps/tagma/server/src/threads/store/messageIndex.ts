import { projectionOf } from '@runlith/search-text/fts';
import type { IndexFill } from '../../platform/contract/service/ownStore.js';
import { MESSAGE_FTS } from './conversation.js';

export const messageIndexFill: IndexFill = {
  table: MESSAGE_FTS,
  fill: (db) => {
    const insert = db.prepare(`insert into ${MESSAGE_FTS}(rowid, text) values (?, ?)`);
    for (const row of db.query<{ key: number; text: string }, []>('select key, text from thread_message').iterate())
      insert.run(row.key, projectionOf(row.text));
  },
};
