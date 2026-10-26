import { Schema } from 'effect';
import type { Unblock } from '../../../platform/contract/wire/refusal.js';
import type { VacuumDeclined } from '../../../platform/contract/wire/vacuum.js';

export const storeSizeSchema = Schema.Struct({
  pages: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  freePages: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  pageSize: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const vacuumSchema = Schema.Struct({
  before: storeSizeSchema,
  after: storeSizeSchema,
  pagesReturned: Schema.Int,
  heldMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const vacuumRefusal = (
  declined: VacuumDeclined,
): { readonly code: VacuumDeclined['outcome']; readonly reason: string; readonly unblock: Unblock } =>
  declined.outcome === 'disk-short'
    ? {
        code: 'disk-short',
        reason: `the rewrite copies the whole file and the filesystem holds less than it weighs: ${declined.fileBytes} bytes of database against ${declined.freeBytes} bytes free`,
        unblock: [
          'free room on the filesystem holding the database, then run it again',
          'until then the freed pages stay on the freelist, where the file keeps them and reuses them',
        ],
      }
    : {
        code: 'no-file',
        reason: 'this server keeps its store in memory, so no bytes on disk can be given back',
        unblock: ['a server opened on a database file vacuums that file'],
      };
