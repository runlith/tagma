import { basename, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { type Context, Data, Effect, FileSystem, type PlatformError, Schema } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { Signing } from '@runlith/codesign/codesign';
import { output } from './command.js';
import { diskImage } from './dmg.js';
import { packRelease } from './pipeline.js';
import { digestOf, type ReleaseRecord, replaced } from './stage.js';
import type { FeedArchive } from '../contract/wire/feed.js';

export class NotarizationRefused extends Data.TaggedError('NotarizationRefused')<{
  readonly detail: string;
  readonly unblock: readonly string[];
}> {}

export type Notary = {
  readonly seal: (cut: string, into: string, record: ReleaseRecord) => Effect.Effect<ReleaseRecord, NotarizationRefused>;
};

export type Developer = { readonly signing: Signing; readonly team: string; readonly assets: string; readonly profile: string };

export type Apple = {
  readonly submit: (path: string) => Effect.Effect<string, NotarizationRefused>;
  readonly accepted: (id: string) => Effect.Effect<void, NotarizationRefused>;
  readonly staple: (path: string) => Effect.Effect<void, NotarizationRefused>;
  readonly assess: (app: string) => Effect.Effect<void, NotarizationRefused>;
  readonly opens: (image: string) => Effect.Effect<void, NotarizationRefused>;
  readonly image: (app: string, image: string) => Effect.Effect<void, NotarizationRefused>;
};

const Submitted = Schema.Struct({ id: Schema.String });
const Answered = Schema.Struct({ id: Schema.String, status: Schema.String });
const decodeSubmitted = Schema.decodeUnknownResult(Schema.fromJsonString(Submitted));
const decodeAnswered = Schema.decodeUnknownResult(Schema.fromJsonString(Answered));
const ACCEPTED = 'Accepted';
const WORK = 'notarization';
const APP_SUBMISSION = 'app.id';
const IMAGE_SUBMISSION = 'image.id';
const SUBMISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const RECUT = 'bun run tagma:release, then bun run tagma:release notarize';
const SPCTL_ACCEPTED = /: accepted\n[\s\S]*source=Notarized Developer ID/u;

type Spawner = ChildProcessSpawner.ChildProcessSpawner;

const refused = (detail: string, unblock: readonly string[] = []) => new NotarizationRefused({ detail, unblock: [...unblock] });

const ran = (command: string, args: readonly string[], cwd: string): Effect.Effect<string, NotarizationRefused, Spawner> =>
  output(command, args, cwd, {}).pipe(
    Effect.mapError((failure) => refused(failure.detail, failure.unblock)),
    Effect.flatMap((answer) =>
      answer.status === 0
        ? Effect.succeed(answer.text)
        : Effect.fail(refused(`${basename(command)} ${args[0]} exited ${answer.status}: ${answer.text.trim()}`)),
    ),
  );

const lastLine = (text: string): string => text.trim().split('\n').at(-1) ?? '';

const gatekeeper = (path: string, kind: readonly string[]): Effect.Effect<void, NotarizationRefused, Spawner> =>
  output('/usr/sbin/spctl', ['--assess', '-vv', ...kind, path], '/', {}).pipe(
    Effect.mapError((failure) => refused(failure.detail, failure.unblock)),
    Effect.flatMap((assessed) =>
      assessed.status === 0 && SPCTL_ACCEPTED.test(assessed.text)
        ? Effect.void
        : Effect.fail(refused(`Gatekeeper refuses the notarized ${basename(path)}: ${assessed.text.trim()}`)),
    ),
  );

const appleOf = (developer: Developer, context: Context.Context<Spawner>): Apple => {
  const profile = ['--keychain-profile', developer.profile, '--output-format', 'json'];
  const missing = (file: string, said: string) =>
    refused(`Apple did not take ${file}: ${said.trim()}`, [
      `xcrun notarytool store-credentials ${developer.profile} --apple-id <the Apple ID of the team> --team-id ${developer.team}, if the profile is missing`,
      'bun run tagma:release notarize — takes up the notarization where it stopped',
    ]);
  const provided = <A>(effect: Effect.Effect<A, NotarizationRefused, Spawner>) => effect.pipe(Effect.provideContext(context));
  return {
    submit: Effect.fn('Notarize.submit')(function* (path: string) {
      const zipped = path.endsWith('.app');
      const file = zipped ? `${path}.zip` : path;
      if (zipped) yield* provided(ran('/usr/bin/ditto', ['-c', '-k', '--keepParent', path, file], join(path, '..')));
      const submitted = yield* provided(
        output('/usr/bin/xcrun', ['notarytool', 'submit', file, ...profile], join(path, '..'), {}).pipe(
          Effect.mapError((failure) => refused(failure.detail, failure.unblock)),
        ),
      );
      const decoded = decodeSubmitted(lastLine(submitted.text));
      if (decoded._tag === 'Failure') return yield* missing(basename(file), submitted.text);
      return decoded.success.id;
    }),
    accepted: Effect.fn('Notarize.wait')(function* (id: string) {
      const answered = yield* provided(
        output('/usr/bin/xcrun', ['notarytool', 'wait', id, ...profile], '/', {}).pipe(
          Effect.mapError((failure) => refused(failure.detail, failure.unblock)),
        ),
      );
      const decoded = decodeAnswered(lastLine(answered.text));
      if (decoded._tag === 'Failure') return yield* missing(`submission ${id}`, answered.text);
      if (decoded.success.status === ACCEPTED) return;
      const log = yield* Effect.result(
        provided(ran('/usr/bin/xcrun', ['notarytool', 'log', id, '--keychain-profile', developer.profile], '/')),
      );
      const told = log._tag === 'Success' ? log.success.trim() : `its log could not be read: ${log.failure.detail}`;
      return yield* refused(`Apple answered ${decoded.success.status} for submission ${id}:\n${told}`, [
        'fix what the log names, then bun run tagma:release and bun run tagma:release publish',
      ]);
    }),
    staple: (path) =>
      provided(
        Effect.andThen(ran('/usr/bin/xcrun', ['stapler', 'staple', path], '/'), ran('/usr/bin/xcrun', ['stapler', 'validate', path], '/')),
      ),
    assess: (app) => provided(gatekeeper(app, ['--type', 'execute'])),
    opens: (image) => provided(gatekeeper(image, ['--type', 'open', '--context', 'context:primary-signature'])),
    image: (app, image) =>
      provided(
        diskImage(app, image, developer.assets, basename(app).replace(/\.app$/u, ''), developer.signing).pipe(
          Effect.mapError((failure) => refused(failure)),
        ),
      ),
  };
};

export const sealingNotary = (apple: Apple): Effect.Effect<Notary, never, FileSystem.FileSystem | Spawner> =>
  Effect.map(Effect.context<FileSystem.FileSystem | Spawner>(), (context) => ({
    seal: (cut, into, record) => sealed(apple, cut, into, record).pipe(Effect.provideContext(context)),
  }));

const sealed = Effect.fn('Notarize.seal')(function* (
  apple: Apple,
  cut: string,
  into: string,
  record: ReleaseRecord,
): Effect.fn.Return<ReleaseRecord, NotarizationRefused, FileSystem.FileSystem | Spawner> {
  const files = yield* FileSystem.FileSystem;
  const failed = (path: string) => (error: PlatformError.PlatformError) =>
    refused(`${path} could not be read or written: ${error.reason._tag}`);
  const at = <A, R>(path: string, effect: Effect.Effect<A, PlatformError.PlatformError, R>) => effect.pipe(Effect.mapError(failed(path)));
  const work = join(into, WORK);
  const submission = Effect.fn('Notarize.submission')(function* (kept: string, path: string) {
    const standing = (yield* at(kept, files.exists(kept))) ? (yield* at(kept, files.readFileString(kept))).trim() : '';
    if (SUBMISSION_ID.test(standing)) return standing;
    const id = yield* apple.submit(path);
    yield* at(kept, replaced(kept, id));
    return id;
  });

  yield* at(work, files.makeDirectory(work, { recursive: true }));
  const chain = Effect.fn('Notarize.platform')(function* (platform: string, one: FeedArchive) {
    const archiveName = basename(one.archive);
    const archive = join(into, archiveName);
    const named = record.images[platform];
    if (named === undefined) return yield* refused(`the cut of ${record.release} holds no disk image of ${platform}`, [RECUT]);
    const imageName = basename(named);
    const image = join(into, imageName);
    const staging = join(work, platform);
    if (!(yield* at(archive, files.exists(archive))) || !(yield* at(image, files.exists(image)))) {
      const appId = join(staging, APP_SUBMISSION);
      if (!(yield* at(appId, files.exists(appId)))) {
        yield* at(staging, files.remove(staging, { recursive: true, force: true }));
        yield* at(staging, files.makeDirectory(staging, { recursive: true }));
        yield* ran('/usr/bin/tar', ['-xzf', join(cut, one.archive), '-C', staging], staging);
      }
      const bundles = (yield* at(staging, files.readDirectory(staging))).filter((name) => name.endsWith('.app'));
      if (bundles.length !== 1)
        return yield* refused(`${one.archive} holds ${bundles.length} applications at its root, and a release is one`);
      const application = bundles[0]!;
      const app = join(staging, application);
      yield* apple.accepted(yield* submission(appId, app));
      yield* apple.staple(app);
      yield* apple.assess(app);
      yield* packRelease(staging, join(staging, archiveName), application).pipe(Effect.mapError((failure) => refused(failure)));
      yield* apple.image(app, join(staging, imageName));
      yield* at(archive, files.rename(join(staging, archiveName), archive));
      yield* at(image, files.rename(join(staging, imageName), image));
      yield* at(app, files.remove(app, { recursive: true, force: true }));
      yield* at(`${app}.zip`, files.remove(`${app}.zip`, { force: true }));
    }
    yield* at(staging, files.makeDirectory(staging, { recursive: true }));
    yield* apple.accepted(yield* submission(join(staging, IMAGE_SUBMISSION), image));
    yield* apple.staple(image);
    yield* apple.opens(image);
    const [sha256, size] = yield* Effect.tryPromise({
      try: () => Promise.all([digestOf(archive), stat(archive).then((info) => info.size)]),
      catch: (error) => refused(`${archive} could not be read: ${String(error)}`),
    });
    return { platform, archive: { archive: archiveName, sha256, size }, image: imageName };
  });
  const chains = yield* Effect.forEach(Object.entries(record.platforms), ([platform, one]) => chain(platform, one), {
    concurrency: 'unbounded',
  });
  const platforms: Record<string, FeedArchive> = Object.fromEntries(chains.map((one) => [one.platform, one.archive]));
  const images: Record<string, string> = Object.fromEntries(chains.map((one) => [one.platform, one.image]));
  return { ...record, platforms, images, notarized: true };
});

export const appleNotary = (developer: Developer): Effect.Effect<Notary, never, FileSystem.FileSystem | Spawner> =>
  Effect.flatMap(Effect.context<Spawner>(), (context) => sealingNotary(appleOf(developer, context)));
