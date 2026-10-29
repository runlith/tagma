import { join } from 'node:path';
import { makeCredentialFile } from '@runlith/credential-file/CredentialFile';
import { CredentialFileInvalid } from '@runlith/credential-file/failure';
import { Data, Effect, FileSystem, Layer, type PlatformError, Schema } from 'effect';
import { SecretOwners } from '../../secrets/contract/service/secrets.js';
import { Settings } from '../../settings/contract/service/values.js';
import { type TagmaAppLaunchProvider, TagmaAppLaunches, TagmaAppLaunchRefused } from '../contract/service/launch.js';
import { TagmaAppPlace } from '../contract/service/supervision.js';
import { SECRETS_POINT, SecretEntries } from '../contract/wire/secrets.js';
import { type TagmaAppInstall, tagmaAppsInstalled } from '../contract/wire/settings.js';

const FORMER = { apps: 'plugins', data: 'plugin-data', manifest: 'plugin.json', secrets: 'plugin-secrets.json', kind: 'plugins' };
const CURRENT = { apps: 'apps', data: 'app-data', manifest: 'tagma-app.json', kind: 'tagma-apps' };

type FormerSecrets = { readonly plugins: Readonly<Record<string, Readonly<Record<string, string>>>> };

const formerSchema = Schema.Struct({ plugins: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)) });

const declaresSecrets = Schema.is(SecretEntries);

export class DataUnmoved extends Data.TaggedError('DataUnmoved')<{ readonly reason: string }> {
  override get message(): string {
    return `the apps in the server's data directory could not be carried over: ${this.reason}`;
  }
}

const unmoved = (what: string) => (failure: { readonly message: string }) => new DataUnmoved({ reason: `${what}: ${failure.message}` });

const directory = Effect.fnUntraced(function* (files: FileSystem.FileSystem, path: string) {
  if (!(yield* files.exists(path))) return false;
  return (yield* files.stat(path)).type === 'Directory';
});

type Merge = (files: FileSystem.FileSystem, from: string, into: string) => Effect.Effect<readonly string[], PlatformError.PlatformError>;

const merged: Merge = Effect.fnUntraced(function* (files, from, into) {
  if (!(yield* files.exists(into))) {
    yield* files.rename(from, into);
    return [];
  }
  if (!(yield* directory(files, from)) || !(yield* directory(files, into))) return [from];
  const left: string[] = [];
  for (const name of yield* files.readDirectory(from)) left.push(...(yield* merged(files, join(from, name), join(into, name))));
  if ((yield* files.readDirectory(from)).length === 0) yield* files.remove(from, { recursive: true });
  return left;
});

const carried = Effect.fnUntraced(function* (files: FileSystem.FileSystem, from: string, into: string) {
  if (!(yield* directory(files, from))) return [];
  return yield* merged(files, from, into);
});

const manifests = Effect.fnUntraced(function* (files: FileSystem.FileSystem, at: string) {
  if (!(yield* directory(files, at))) return;
  for (const name of yield* files.readDirectory(at)) {
    if (!(yield* directory(files, join(at, name)))) continue;
    const former = join(at, name, FORMER.manifest);
    const current = join(at, name, CURRENT.manifest);
    if ((yield* files.exists(former)) && !(yield* files.exists(current))) yield* files.rename(former, current);
  }
});

const sources = Effect.fnUntraced(function* (files: FileSystem.FileSystem, home: string) {
  const settings = yield* Settings;
  const leaving = `${join(home, FORMER.apps)}/`;
  const moves = new Map<string, string>();
  for (const install of yield* settings.value(tagmaAppsInstalled)) {
    if (!install.source.startsWith(leaving)) continue;
    const current = join(home, CURRENT.apps, install.source.slice(leaving.length));
    if (yield* directory(files, current)) moves.set(install.source, current);
  }
  if (moves.size === 0) return;
  yield* settings.amend<readonly TagmaAppInstall[], never>(tagmaAppsInstalled, 'user', undefined, (current) =>
    Effect.succeed(current.map((install) => ({ ...install, source: moves.get(install.source) ?? install.source }))),
  );
});

const moved = Effect.gen(function* () {
  const { home } = yield* TagmaAppPlace;
  if (home === null) return;
  const files = yield* FileSystem.FileSystem;
  const apps = yield* carried(files, join(home, FORMER.apps), join(home, CURRENT.apps)).pipe(
    Effect.mapError(unmoved(join(home, FORMER.apps))),
  );
  yield* manifests(files, join(home, CURRENT.apps)).pipe(Effect.mapError(unmoved(join(home, CURRENT.apps))));
  const data = yield* carried(files, join(home, FORMER.data), join(home, CURRENT.data)).pipe(
    Effect.mapError(unmoved(join(home, FORMER.data))),
  );
  yield* sources(files, home).pipe(Effect.mapError(unmoved('the installed apps')));
  const left = [...apps, ...data];
  if (left.length > 0)
    yield* Effect.logWarning(
      `these files of the former apps stay where they were, because the same name already stands at their new place: ${left.join(', ')}`,
    );
}).pipe(Effect.withSpan('tagmaApps.dataMoved'));

const secrets = Effect.fnUntraced(function* (files: FileSystem.FileSystem, home: string) {
  const owners = yield* SecretOwners;
  yield* owners.move(FORMER.kind, CURRENT.kind);
  const path = join(home, FORMER.secrets);
  const former = makeCredentialFile<FormerSecrets>({
    path,
    codec: {
      empty: () => ({ plugins: {} }),
      decode: (at, parsed) =>
        Schema.decodeUnknownEffect(formerSchema)(parsed).pipe(
          Effect.map((value) => ({ value, needsWrite: false })),
          Effect.mapError(() => new CredentialFileInvalid({ path: at, reason: 'the document is not the former secret file' })),
        ),
    },
  });
  const held = yield* former.readFresh();
  if (Object.keys(held.plugins).length > 0) {
    yield* owners.adopt(CURRENT.kind, held.plugins);
    const given = yield* owners.handout(CURRENT.kind);
    const lost = Object.entries(held.plugins).some(([id, values]) =>
      Object.entries(values).some(([name, value]) => value !== '' && given(id).values[name] === undefined),
    );
    if (lost) return yield* new DataUnmoved({ reason: `the values in ${path} did not reach the secret store` });
  }
  yield* files.remove(path, { force: true });
  yield* files.remove(`${path}.lock`, { force: true });
});

const refusing =
  (path: string): TagmaAppLaunchProvider =>
  (request) => {
    const entries = request.contributes[SECRETS_POINT];
    return declaresSecrets(entries) && entries.length > 0
      ? Effect.fail(
          new TagmaAppLaunchRefused({
            reason: `the secrets kept in ${path} did not reach the secret store, so an app that declares secrets does not start without them; make ${path} and the secret store beside it readable, then start the server again`,
          }),
        )
      : Effect.succeed({ env: {}, redact: [] });
  };

const kept = Effect.gen(function* () {
  const { home } = yield* TagmaAppPlace;
  if (home === null) return;
  const files = yield* FileSystem.FileSystem;
  const launches = yield* TagmaAppLaunches;
  const path = join(home, FORMER.secrets);
  yield* secrets(files, home).pipe(
    Effect.matchEffect({
      onSuccess: () => Effect.void,
      onFailure: (failure) =>
        Effect.logWarning(`${path} was not carried into the secret store (${failure._tag}); apps that declare secrets do not start`).pipe(
          Effect.andThen(Effect.acquireRelease(launches.provide(refusing(path)), (withdraw) => Effect.sync(withdraw))),
        ),
    }),
  );
}).pipe(Effect.withSpan('tagmaApps.secretsMoved'));

export const dataMoved: Layer.Layer<never, never, TagmaAppPlace | Settings | FileSystem.FileSystem> = Layer.effectDiscard(
  Effect.orDie(moved),
);

export const secretsMoved: Layer.Layer<never, never, TagmaAppPlace | SecretOwners | TagmaAppLaunches | FileSystem.FileSystem> =
  Layer.effectDiscard(kept);
