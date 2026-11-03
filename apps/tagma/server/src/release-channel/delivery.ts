import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { Data, Duration, Effect, Stream } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import type { ReleaseArchive } from '../installation/contract/wire/feed.js';

const IDLE = Duration.seconds(60);

export class Undelivered extends Data.TaggedError('Undelivered')<{ readonly detail: string }> {}

export const undelivered = (detail: string) => new Undelivered({ detail });

export const downloaded = Effect.fn('release.download')(function* (
  client: HttpClient.HttpClient,
  release: ReleaseArchive,
  file: string,
  progressed: (done: number, total: number) => Effect.Effect<void>,
) {
  mkdirSync(dirname(file), { recursive: true });
  const response = yield* client
    .execute(HttpClientRequest.get(release.archive).pipe(HttpClientRequest.setHeader('accept', 'application/octet-stream')))
    .pipe(Effect.mapError((failure) => undelivered(`the archive at ${release.archive} could not be reached: ${failure.message}`)));
  if (response.status < 200 || response.status >= 300) {
    return yield* undelivered(`the archive at ${release.archive} answered ${response.status}`);
  }
  const hash = createHash('sha256');
  const part = `${file}.part`;
  let done = 0;
  const stalled = () =>
    Stream.fail(
      undelivered(
        `the download of release ${release.release} received nothing for ${Duration.toSeconds(IDLE)} s and was given up at ${done} bytes`,
      ),
    );
  yield* Effect.acquireUseRelease(
    Effect.sync(() => openSync(part, 'w', 0o600)),
    (fd) =>
      Stream.runForEach(response.stream.pipe(Stream.timeoutOrElse({ duration: IDLE, orElse: stalled })), (chunk) =>
        Effect.suspend(() => {
          if (chunk.length > release.size - done) {
            return undelivered(`the download of release ${release.release} exceeds its declared ${release.size} bytes`);
          }
          writeSync(fd, chunk);
          hash.update(chunk);
          done += chunk.length;
          return progressed(done, release.size);
        }),
      ).pipe(
        Effect.mapError((failure) =>
          failure._tag === 'Undelivered'
            ? failure
            : undelivered(`the download of release ${release.release} broke off at ${done} bytes: ${failure.message}`),
        ),
      ),
    (fd) => Effect.sync(() => closeSync(fd)),
  );
  if (done !== release.size) {
    return yield* undelivered(`the download of release ${release.release} ended at ${done} bytes, and the feed declares ${release.size}`);
  }
  renameSync(part, file);
  return hash.digest('hex');
});
