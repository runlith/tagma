import { Effect, Schema } from 'effect';
import { workerLink } from '@runlith/utils/worker';
import { ArchiveInspection, type ArchiveAsk } from './inspection.js';
import { undelivered } from './delivery.js';

const TAR = '/usr/bin/tar';
const UNPACK_FLAGS = ['--no-xattrs', '--no-mac-metadata', '--no-acls', '--no-fflags', '--no-same-owner'] as const;

export const inspectArchive = Effect.fn('release.inspectArchive')(function* (file: string) {
  const link = yield* Effect.acquireRelease(
    Effect.sync(() =>
      workerLink<ArchiveAsk, ArchiveInspection>(
        'archive inspection',
        () => new Worker(new URL('./archive.worker.ts', import.meta.url), { type: 'module' }),
      ),
    ),
    (link) => link.shutdown('the archive inspection ended'),
  );
  const answer = yield* link.ask((id) => ({ id, file })).pipe(Effect.mapError((error) => undelivered(error.message)));
  const inspected = yield* Schema.decodeUnknownEffect(ArchiveInspection)(answer).pipe(
    Effect.mapError(() => undelivered('the archive inspection answered unreadably')),
  );
  if ('refused' in inspected) return yield* undelivered(`the archive is refused before it unpacks: ${inspected.refused}`);
  return inspected.footprint;
}, Effect.scoped);

export const unpackCommand = (file: string, into: string): readonly string[] => [TAR, '-xzf', file, '-C', into, ...UNPACK_FLAGS];
