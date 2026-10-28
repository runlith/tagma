import { Deferred, Effect, Exit, FileSystem, Path, Schema, Stream } from 'effect';
import { RELEASE as CHROME_RELEASE, platformOf, executableIn, type Platform } from '@runlith/chrome-for-testing/build';
import { HttpClient, HttpClientRequest } from 'effect/http';
import { ChildProcess, type ChildProcessSpawner } from 'effect/process';
import { Background } from '../../platform/contract/service/background.js';
import { ManagedPlace } from '../contract/service/place.js';
import { type Build, BuildUnavailable } from './build.js';
import { chromeArgs } from './chrome.js';

const releaseUrl = (release: string) => `https://googlechromelabs.github.io/chrome-for-testing/${release}.json`;

const Downloads = Schema.Struct({
  version: Schema.String,
  downloads: Schema.Struct({ chrome: Schema.Array(Schema.Struct({ platform: Schema.String, url: Schema.String })) }),
});

export const makeChromeForTesting = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const client = HttpClient.withScope(yield* HttpClient.HttpClient);
  const place = yield* ManagedPlace;
  const background = yield* Background;
  const spawner = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
  const platform = platformOf(process.platform, process.arch);
  const scope = yield* Effect.scope;
  const dir = path.join(place.builds, 'chrome-for-testing', CHROME_RELEASE);
  let installing: Deferred.Deferred<string, BuildUnavailable> | null = null;

  const unavailable = (reason: string) =>
    new BuildUnavailable({
      message: `Chrome for Testing ${CHROME_RELEASE} is not available: ${reason}`,
      unblock: ['check that this machine reaches googlechromelabs.github.io and storage.googleapis.com, then open the page again'],
    });

  const run = (command: string, args: readonly string[]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(command, args, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
        const said = yield* handle.all.pipe(Stream.decodeText(), Stream.mkString);
        const code = yield* handle.exitCode;
        return { code: Number(code), said };
      }),
    ).pipe(
      Effect.provide(spawner),
      Effect.mapError((failure) => unavailable(failure.message)),
    );

  const fetched = Effect.fn('chromeForTesting.fetch')(function* (target: Platform, into: string) {
    const listed = yield* client.execute(HttpClientRequest.get(releaseUrl(CHROME_RELEASE))).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Downloads)),
      Effect.mapError((failure) => unavailable(`its download list could not be read: ${failure.message}`)),
      Effect.scoped,
    );
    const url = listed.downloads.chrome.find((held) => held.platform === target)?.url;
    if (url === undefined) return yield* unavailable(`no download is published for ${target}`);
    const zip = path.join(into, 'chrome.zip');
    yield* Effect.scoped(
      Effect.gen(function* () {
        const response = yield* client.execute(HttpClientRequest.get(url));
        if (response.status !== 200) return yield* unavailable(`${url} answered HTTP ${response.status}`);
        const length = Number(response.headers['content-length']);
        yield* background.run(
          {
            title: `Installing Chrome for Testing ${CHROME_RELEASE}`,
            reason: 'the managed browser downloads it once, on its first start',
            total: Number.isSafeInteger(length) && length > 0 ? length : null,
          },
          (progress) =>
            response.stream.pipe(
              Stream.tap((chunk) => progress.advance(chunk.byteLength)),
              Stream.run(files.sink(zip)),
            ),
        );
      }),
    ).pipe(
      Effect.mapError((failure) =>
        failure instanceof BuildUnavailable ? failure : unavailable(`the download failed: ${failure.message}`),
      ),
    );
    return zip;
  });

  const install = Effect.fn('chromeForTesting.install')(function* (target: Platform) {
    const partial = `${dir}.partial`;
    yield* files.remove(partial, { recursive: true, force: true }).pipe(Effect.mapError((failure) => unavailable(failure.message)));
    yield* files.makeDirectory(partial, { recursive: true }).pipe(Effect.mapError((failure) => unavailable(failure.message)));
    const zip = yield* fetched(target, partial);
    const unpacked =
      process.platform === 'darwin' ? yield* run('ditto', ['-x', '-k', zip, partial]) : yield* run('unzip', ['-q', zip, '-d', partial]);
    if (unpacked.code !== 0) return yield* unavailable(`the archive did not unpack: ${unpacked.said.trim()}`);
    const executable = executableIn(partial, target);
    const reported = yield* run(executable, ['--version']);
    if (reported.code !== 0 || !reported.said.includes(CHROME_RELEASE)) {
      return yield* unavailable(`the unpacked browser reports ${JSON.stringify(reported.said.trim())}`);
    }
    yield* files.remove(zip).pipe(Effect.mapError((failure) => unavailable(failure.message)));
    yield* files.rename(partial, dir).pipe(Effect.mapError((failure) => unavailable(failure.message)));
    return executableIn(dir, target);
  });

  const verified = Effect.fn('chromeForTesting.verified')(function* (target: Platform) {
    const standing = executableIn(dir, target);
    if (yield* files.exists(standing).pipe(Effect.mapError((failure) => unavailable(failure.message)))) {
      const reported = yield* run(standing, ['--version']).pipe(
        Effect.catchTag('BuildUnavailable', () => Effect.succeed({ code: -1, said: '' })),
      );
      if (reported.code === 0 && reported.said.includes(CHROME_RELEASE)) return standing;
      yield* Effect.logWarning(
        `managed browser: the cached Chrome for Testing reports ${JSON.stringify(reported.said.trim())}; installing it again`,
      );
      yield* files.remove(dir, { recursive: true, force: true }).pipe(Effect.mapError((failure) => unavailable(failure.message)));
    }
    return yield* install(target);
  });

  const executable = Effect.gen(function* () {
    if (platform === null) return yield* unavailable(`no build is published for ${process.platform}-${process.arch}`);
    if (installing !== null) return yield* Deferred.await(installing);
    const done = yield* Deferred.make<string, BuildUnavailable>();
    installing = done;
    yield* verified(platform).pipe(
      Effect.onExit((exit) =>
        Effect.andThen(
          Deferred.done(done, exit),
          Effect.sync(() => {
            if (Exit.isFailure(exit)) installing = null;
          }),
        ),
      ),
      Effect.forkIn(scope),
    );
    return yield* Deferred.await(done);
  });

  return {
    id: 'chrome-for-testing',
    launch: Effect.map(executable, (path) => ({ executable: path, args: (profileDir: string) => chromeArgs(CHROME_RELEASE, profileDir) })),
  } satisfies Build;
});
