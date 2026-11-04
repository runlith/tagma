import { Effect, Fiber, Schema } from 'effect';
import { workerLink } from '@runlith/utils/worker';
import { ArchiveAnswer, type ArchiveAsk, type ArchiveFootprint } from './protocol.js';
import { type Undelivered, undelivered } from './delivery.js';

type Archive = {
  readonly footprint: ArchiveFootprint;
  readonly unpack: (into: string) => Effect.Effect<void, Undelivered>;
};

export const openArchive = Effect.fn('release.inspectArchive')(function* (file: string) {
  const link = yield* Effect.acquireRelease(
    Effect.sync(() =>
      workerLink<ArchiveAsk, ArchiveAnswer>(
        'release archive',
        () => new Worker(new URL('./archive.worker.ts', import.meta.url), { type: 'module' }),
      ),
    ),
    (link) => link.shutdown('the release archive closed'),
  );
  const decoded = (answer: unknown) =>
    Schema.decodeUnknownEffect(ArchiveAnswer)(answer).pipe(
      Effect.mapError(() => undelivered('the release archive worker answered unreadably')),
    );
  const inspected = yield* link
    .ask((id) => ({ _tag: 'Inspect', id, file }))
    .pipe(
      Effect.mapError((error) => undelivered(error.message)),
      Effect.flatMap(decoded),
    );
  if ('refused' in inspected) return yield* undelivered(`the archive is refused before it unpacks: ${inspected.refused}`);
  if (!('footprint' in inspected)) return yield* undelivered('the release archive worker answered without its footprint');
  return {
    footprint: inspected.footprint,
    unpack: Effect.fn('release.unpackArchive')(function* (into: string) {
      const running = yield* Effect.forkScoped(link.run((id) => ({ _tag: 'Unpack', id, file, into })));
      const unpacked = yield* Fiber.join(running).pipe(
        Effect.onInterrupt(() => Effect.sync(() => link.tell({ _tag: 'Cancel' }))),
        Effect.mapError((error) => undelivered(error.message)),
        Effect.flatMap(decoded),
      );
      if ('refused' in unpacked) return yield* undelivered(`the release archive could not unpack: ${unpacked.refused}`);
      if (!('unpacked' in unpacked)) return yield* undelivered('the release archive worker did not confirm extraction');
    }, Effect.scoped),
  } satisfies Archive;
});
