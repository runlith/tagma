import { Context, Data, Effect, FileSystem, Layer } from 'effect';
import { dirname } from 'node:path';
import type { EnvironmentBinding } from '../../workspace/contract/wire/environments.js';
import { HARNESS_ID_MAX } from '../../threads/contract/wire/harness/observation.js';
import type { Environments } from '../../workspace/contract/service/environments.js';
import { MetadataFile } from '../metadata/file.js';
import { DOCUMENT_LIMITS } from '../metadata/policy.js';

export type WitnessRead =
  | { readonly _tag: 'Found'; readonly id: string }
  | { readonly _tag: 'Missing' }
  | { readonly _tag: 'Unreadable'; readonly reason: string };

class WitnessFailed extends Data.TaggedError('WitnessFailed')<{ readonly reason: string }> {}

export type WitnessTry = 'moot' | 'named' | 'silent';

const WITNESS_PAGES = Math.ceil(DOCUMENT_LIMITS.recordBytes / DOCUMENT_LIMITS.bytes) + 1;

export const readWitness = Effect.fn('HarnessWitness.read')(
  function* (access: Environments['Service'], binding: EnvironmentBinding, exportPath: string, witness: (text: string) => string | null) {
    if (exportPath.length === 0) return { _tag: 'Missing' } as WitnessRead;
    const consumer = { kind: 'harness-witness', id: exportPath };
    const acquired = yield* access
      .acquireActive({ binding, consumer, requires: ['files'] })
      .pipe(Effect.mapError((refusal) => new WitnessFailed({ reason: refusal._tag })));
    yield* Effect.addFinalizer(() =>
      acquired.use._tag === 'Retained'
        ? access.releaseUse(acquired.use.use.useId, consumer, 'cleanup-confirmed').pipe(
            Effect.catch(() => Effect.logWarning('witness environment use could not be released')),
            Effect.asVoid,
          )
        : Effect.void,
    );
    if (acquired.world.files === undefined) return yield* new WitnessFailed({ reason: 'files-unsupported' });
    const files = Context.get(yield* Layer.build(acquired.world.files), FileSystem.FileSystem);
    const cursor = new MetadataFile<string>({ json: true, empty: () => '', line: (_, text) => text }, DOCUMENT_LIMITS);
    const root = dirname(exportPath);
    let page = yield* cursor.read(files, root, exportPath);
    for (let at = 1; page._tag === 'Read' && !page.complete && at < WITNESS_PAGES; at++) {
      page = yield* cursor.read(files, root, exportPath);
    }
    if (page._tag === 'Absent') return { _tag: 'Missing' } as const;
    if (page._tag === 'Unreadable') return { _tag: 'Unreadable', reason: page.reason } as const;
    if (!page.complete) return { _tag: 'Unreadable', reason: 'limit' } as const;
    const id = witness(page.value);
    if (id === null || id.length === 0 || id.length > HARNESS_ID_MAX) return { _tag: 'Missing' } as const;
    return { _tag: 'Found', id } as WitnessRead;
  },
  Effect.scoped,
  Effect.catchTag('WitnessFailed', (failed) => Effect.succeed({ _tag: 'Unreadable', reason: failed.reason } as const)),
  Effect.tap((read) =>
    Effect.gen(function* () {
      if (read._tag === 'Found') return yield* Effect.withSpan(Effect.void, 'HarnessWitness.found');
      if (read._tag === 'Missing') return yield* Effect.withSpan(Effect.void, 'HarnessWitness.missing');
      yield* Effect.withSpan(Effect.void, 'HarnessWitness.unreadable');
      yield* Effect.withSpan(Effect.void, `HarnessWitness.unreadable.${read.reason}`);
    }),
  ),
);
