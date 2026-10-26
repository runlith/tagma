import { createHash, type Hash } from 'node:crypto';
import { Effect, type FileSystem, Stream } from 'effect';
import { HttpClient, HttpClientRequest, type HttpClientResponse } from 'effect/http';
import type { ModelArtifact } from './catalog.ts';
import { DownloadFailed, IntegrityFailed, StoreFailed } from './failures.ts';

const resumed = /^bytes (\d+)-(\d+)\/(\d+)$/;

const startOf = (
  response: HttpClientResponse.HttpClientResponse,
  artifact: ModelArtifact,
  have: number,
): Effect.Effect<number, DownloadFailed> => {
  const refuse = (reason: string) => Effect.fail(new DownloadFailed({ model: artifact.id, reason }));
  if (response.status === 200) return Effect.succeed(0);
  if (response.status !== 206 || have === 0) return refuse(`the host answered HTTP ${response.status}`);
  const range = resumed.exec(response.headers['content-range'] ?? '');
  if (range === null || Number(range[1]) !== have || Number(range[3]) !== artifact.size) {
    return refuse('the host did not resume at the bytes already downloaded');
  }
  return Effect.succeed(have);
};

export type Received = {
  readonly bytes: number;
  readonly digest?: string | undefined;
};

const stored = (failure: { readonly message: string }) => new StoreFailed({ reason: failure.message });

export const fold = (fs: FileSystem.FileSystem, file: string, hash: Hash): Effect.Effect<Hash, StoreFailed> =>
  fs.stream(file).pipe(
    Stream.runForEach((chunk) => Effect.sync(() => hash.update(chunk))),
    Effect.mapError(stored),
    Effect.as(hash),
  );

export const download = (
  fs: FileSystem.FileSystem,
  client: HttpClient.HttpClient,
  artifact: ModelArtifact,
  file: string,
  have: number,
): Stream.Stream<Received, DownloadFailed | IntegrityFailed | StoreFailed> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const headers: Record<string, string> = { 'accept-encoding': 'identity' };
      if (have > 0) headers['range'] = `bytes=${have}-`;
      const response = yield* HttpClient.withScope(client)
        .execute(HttpClientRequest.get(artifact.url, { headers }))
        .pipe(Effect.mapError((failure) => new DownloadFailed({ model: artifact.id, reason: failure.message })));
      const from = yield* startOf(response, artifact, have);
      const hash = from === 0 ? createHash('sha256') : yield* fold(fs, file, createHash('sha256'));
      const handle = yield* fs.open(file, { flag: from === 0 ? 'w' : 'a', mode: 0o600 }).pipe(Effect.mapError(stored));
      let received = from;
      const write = (chunk: Uint8Array) =>
        Effect.suspend((): Effect.Effect<Received, IntegrityFailed | StoreFailed> => {
          if (received + chunk.byteLength > artifact.size) {
            return Effect.fail(new IntegrityFailed({ model: artifact.id, reason: 'the host sent more bytes than the model holds' }));
          }
          return handle.writeAll(chunk).pipe(
            Effect.mapError(stored),
            Effect.map(() => {
              hash.update(chunk);
              received += chunk.byteLength;
              return { bytes: received };
            }),
          );
        });
      const sealed = Effect.mapError(handle.sync, stored).pipe(
        Effect.map((): Received => ({ bytes: received, digest: hash.digest('hex') })),
      );
      return response.stream.pipe(
        Stream.mapError((failure) => new DownloadFailed({ model: artifact.id, reason: failure.message })),
        Stream.mapEffect(write),
        Stream.concat(Stream.fromEffect(sealed)),
      );
    }),
  );
