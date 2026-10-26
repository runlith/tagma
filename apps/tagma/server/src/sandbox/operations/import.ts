import { importFile, type ImportLanded } from '@runlith/agent-tools/importFile';
import { Effect } from 'effect';
import { routed } from '../../platform/contract/service/routed.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
import { CallerWorkspace } from '../../workspace/contract/service/places.js';
import { GuestFileReader, ImportDestination } from '../contract/service/imports.js';
import { SANDBOX_OPERATIONS as OPS } from '../contract/wire/operations/catalog.js';
import { importRefusal, type ImportRefusalCode } from '../guests/imports.js';

const IMPORT_WAYS: Readonly<Record<ImportRefusalCode, Unblock>> = {
  'expected-base': ['read what stands at the destination now and name its digest as `expect`'],
  'destination-path': ['name a path inside this checkout the import may write'],
  'import-source': ['name a sandbox this owner prepared, and a path relative to its tree'],
  'sandbox-unavailable': ['read the sandbox: its state and its reason say what stopped it'],
};

const NO_IMPORT_RECORD: Unblock = [
  "run it from a Tagma session's own shell, which carries this server's grant",
  'import from the agent, whose thread is the session the record keys on',
];

export const IMPORT_ROUTED = {
  import_output: routed(OPS.import_output, {
    execute: Effect.fnUntraced(function* (input: (typeof OPS.import_output)['input']['Type'], _prepared: undefined, caller: Caller) {
      if (caller.actor.kind !== 'thread') {
        return yield* new GateRefusal(
          'no-record',
          'this call carries no session Tagma records, so an import would land bytes no session holds',
          NO_IMPORT_RECORD,
        );
      }
      if ((yield* CallerWorkspace) === null) {
        return yield* new GateRefusal(
          'no-record',
          'this caller has no proved checkout workspace, so an import has no recorded destination',
          NO_IMPORT_RECORD,
        );
      }
      const destination = yield* ImportDestination;
      if (destination === null) {
        return yield* new GateRefusal(
          'no-record',
          'this operation road provides no recorded import destination for this caller',
          NO_IMPORT_RECORD,
        );
      }
      const source = yield* GuestFileReader;
      if (source === null) {
        return yield* new GateRefusal(
          'import-source',
          'this operation road provides no sandbox source for this caller',
          IMPORT_WAYS['import-source'],
        );
      }
      const landed = yield* importFile(destination, source, {
        source: { kind: 'sandbox', id: input.sandbox },
        from: input.from,
        to: input.to,
        expect: input.expect,
      }).pipe(
        Effect.catch((failure) => {
          const refusal = importRefusal(failure);
          return Effect.fail(new GateRefusal(refusal.code, refusal.reason, IMPORT_WAYS[refusal.code]));
        }),
      );
      return {
        status: 'imported' as const,
        sandbox: input.sandbox,
        path: landed.path,
        created: landed.created,
        digest: landed.digest,
        lines: landed.lines,
        from: landed.from,
        comments: landed.comments,
        recorded: landed.recorded,
      };
    }),
    answer: ({ sandbox: _asked, ...landed }: { readonly status: 'imported'; readonly sandbox: string } & ImportLanded) => landed,
  }),
};
