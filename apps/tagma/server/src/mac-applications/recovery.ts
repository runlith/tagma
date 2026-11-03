import { basename, dirname, join } from 'node:path';
import { Processes } from '@runlith/execution-host/ProcessReader';
import type { DeclaredPart } from '@runlith/executions/protocol/evidence';
import { Effect, FileSystem, Stream } from 'effect';
import { WindowDeclarations } from '../executions/contract/service/load.js';
import { bundleOf } from './placement.js';

type Recovery =
  | { readonly _tag: 'Recovered' }
  | { readonly _tag: 'Gone' }
  | { readonly _tag: 'Unproven' | 'Refused'; readonly detail: string };

type Pulse = { readonly _tag: 'Declared'; readonly parts: readonly DeclaredPart[] } | { readonly _tag: 'Retry' };

const RETRY = '1 second';

export const recoverApplications = Effect.gen(function* () {
  const processes = yield* Processes;
  const windows = yield* WindowDeclarations;
  const files = yield* FileSystem.FileSystem;
  const settled = new Set<string>();
  const pending = new Map<string, DeclaredPart>();

  const recover = Effect.fn('macApplications.recover')(function* (part: DeclaredPart): Effect.fn.Return<Recovery, never> {
    const witness = processes.resolve(part);
    if (witness === 'different') return { _tag: 'Gone' };
    if (witness === 'unknown') return { _tag: 'Unproven', detail: `the declared window process ${part.pid} is unknown` };
    return yield* Effect.gen(function* () {
      const reading = yield* processes.facts([part.pid]);
      const found = reading.processes.find((one) => one.pid === witness.pid);
      if (found === undefined) {
        const unread = reading.unread.find((one) => one.pid === witness.pid);
        if (unread?._tag === 'Gone') return { _tag: 'Gone' } as const;
        return { _tag: 'Unproven', detail: unread?.detail ?? `the declared window process ${part.pid} was not read` } as const;
      }
      if (found.birth !== witness.birth) return { _tag: 'Gone' } as const;
      if (found.executable._tag === 'Unreadable') return { _tag: 'Unproven', detail: found.executable.detail } as const;
      const bundle = bundleOf(found.executable.value);
      if (bundle === null)
        return { _tag: 'Unproven', detail: `the executable of window process ${part.pid} names no primary application` } as const;
      if (!(yield* files.exists(bundle))) return { _tag: 'Unproven', detail: `the primary application ${bundle} is missing` } as const;
      yield* files.remove(join(dirname(bundle), `.${basename(bundle)}.outgoing`), { recursive: true, force: true });
      return { _tag: 'Recovered' } as const;
    }).pipe(
      Effect.match({
        onFailure: (failure): Recovery => ({ _tag: 'Refused', detail: failure.message }),
        onSuccess: (result) => result,
      }),
    );
  });

  const declarations = Stream.map(windows.parts, (parts): Pulse => ({ _tag: 'Declared', parts }));
  const retries = Stream.map(Stream.drop(Stream.tick(RETRY), 1), (): Pulse => ({ _tag: 'Retry' }));
  yield* Stream.runForEach(Stream.merge(declarations, retries, { haltStrategy: 'left' }), (pulse) =>
    Effect.gen(function* () {
      if (pulse._tag === 'Declared') {
        const live = new Set<string>();
        for (const part of pulse.parts) {
          if (windows.part(part.key)?.process.kind !== 'main') continue;
          live.add(part.key);
          if (!settled.has(part.key)) pending.set(part.key, part);
        }
        for (const key of pending.keys()) if (!live.has(key)) pending.delete(key);
        for (const key of settled) if (!live.has(key)) settled.delete(key);
      }
      for (const [key, part] of pending) {
        if (windows.part(key)?.process.kind !== 'main') {
          pending.delete(key);
          continue;
        }
        const result = yield* recover(part);
        if (result._tag === 'Recovered' || result._tag === 'Gone') {
          settled.add(key);
          pending.delete(key);
        } else yield* Effect.logWarning(`application recovery ${result._tag.toLowerCase()}: ${result.detail}`);
      }
    }),
  );
});
