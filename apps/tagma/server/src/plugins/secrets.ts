import { join } from 'node:path';
import { makeCredentialFile } from '@runlith/credential-file/CredentialFile';
import { CredentialFileInvalid } from '@runlith/credential-file/failure';
import { Data, Effect, FileSystem, Schema, Semaphore } from 'effect';
import type { StoreFailure } from '../platform/contract/service/store.js';
import type { GateRefusal } from '../platform/contract/wire/refusal.js';
import { type SecretOwner, SecretOwnerFailed, SecretOwners } from '../secrets/contract/service/secrets.js';
import { type PluginLaunchEnvironment, PluginLaunchRefused, type PluginLaunchRequest } from './contract/service/launch.js';
import type { PluginPoint } from './contract/service/points.js';
import type { Plugins } from './contract/service/supervision.js';
import { plugins as declaration } from './contract/wire/module.js';
import { SECRETS_POINT, SecretEntries } from './contract/wire/secrets.js';
import type { Supervisor } from './supervisor.js';

export const SECRET_KIND = declaration.id;

export const FORMER_SECRETS = 'plugin-secrets.json';

type FormerDocument = { readonly plugins: Readonly<Record<string, Readonly<Record<string, string>>>> };

const formerSchema = Schema.Struct({ plugins: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)) });

class SecretsUnmoved extends Data.TaggedError('SecretsUnmoved') {}

const isEntries = Schema.is(SecretEntries);
const NOTHING: PluginLaunchEnvironment = { env: {}, redact: [] };
const UNREADABLE = 'the secret store could not be read, so its process does not start without its secrets';
const UNMOVED = `the secrets in ${FORMER_SECRETS} could not be moved into the secret store, so its process does not start without them`;

const ownerFailed = (failure: StoreFailure | GateRefusal) =>
  failure._tag === 'GateRefusal'
    ? new SecretOwnerFailed({ reason: failure.reason, unblock: failure.unblock })
    : new SecretOwnerFailed({ reason: failure.message, unblock: ['repeat once the store answers'] });

export const makeFormer = Effect.fnUntraced(function* (input: { readonly home: string | null }) {
  const { home } = input;
  const owners = yield* SecretOwners;
  const files = yield* FileSystem.FileSystem;
  const moving = yield* Semaphore.make(1);
  const formerPath = home === null ? null : join(home, FORMER_SECRETS);
  const former =
    formerPath === null
      ? null
      : makeCredentialFile<FormerDocument>({
          path: formerPath,
          codec: {
            empty: () => ({ plugins: {} }),
            decode: (path, parsed) =>
              Schema.decodeUnknownEffect(formerSchema)(parsed).pipe(
                Effect.map((value) => ({ value, needsWrite: false })),
                Effect.mapError(() => new CredentialFileInvalid({ path, reason: 'the document is not the former secret file' })),
              ),
          },
        });
  let moved = former === null;

  const move = Effect.fn('Shelf.move')(
    function* () {
      if (moved || former === null || formerPath === null) return;
      const held = yield* former.readFresh();
      yield* owners.adopt(SECRET_KIND, held.plugins);
      const given = yield* owners.handout(SECRET_KIND);
      const lost = Object.entries(held.plugins).some(([id, values]) =>
        Object.entries(values).some(([name, value]) => value !== '' && given(id).values[name] === undefined),
      );
      if (lost) return yield* new SecretsUnmoved();
      yield* files.remove(formerPath, { force: true });
      yield* files.remove(`${formerPath}.lock`, { force: true });
      moved = true;
    },
    (effect) => moving.withPermit(Effect.mapError(effect, () => new SecretsUnmoved())),
  );

  return { move };
});

export type Former = Effect.Success<ReturnType<typeof makeFormer>>;

export const makeShelf = Effect.fnUntraced(function* (input: {
  readonly former: Former;
  readonly plugins: Plugins['Service'];
  readonly supervisor: Supervisor;
}) {
  const { former, plugins, supervisor } = input;
  const { move } = former;
  const owners = yield* SecretOwners;
  const declared = new Map<string, SecretEntries>();

  const owner: SecretOwner = {
    kind: SECRET_KIND,
    holders: Effect.fn('Shelf.holders')(function* (projectId: number) {
      yield* move().pipe(
        Effect.mapError(
          () =>
            new SecretOwnerFailed({
              reason: UNMOVED,
              unblock: [`make ${FORMER_SECRETS} in the server’s data directory readable to the server, then repeat`],
            }),
        ),
      );
      const rows = yield* plugins.list(projectId).pipe(Effect.mapError(ownerFailed));
      return rows.flatMap((row) => {
        const entries = row.installed?.enabled === true ? declared.get(row.id) : undefined;
        return entries === undefined ? [] : [{ id: row.id, key: row.id, title: row.title ?? row.id, entries }];
      });
    }),
    changed: (key) => supervisor.changed(key),
  };

  return {
    owner,
    point: {
      name: SECRETS_POINT,
      owner: SECRET_KIND,
      schema: SecretEntries,
      register: () => Effect.succeed(() => undefined),
    } satisfies PluginPoint<SecretEntries>,
    provide: Effect.fn('Shelf.provide')(function* (request: PluginLaunchRequest) {
      const entries = request.contributes[SECRETS_POINT];
      if (entries === undefined) {
        declared.delete(request.plugin);
        return NOTHING;
      }
      if (!isEntries(entries))
        return yield* new PluginLaunchRefused({ reason: 'the secrets the plugin declares are not a list of secrets' });
      declared.set(request.plugin, entries);
      if (entries.length === 0) return NOTHING;
      yield* move().pipe(Effect.mapError(() => new PluginLaunchRefused({ reason: UNMOVED })));
      const handouts = yield* owners.handout(SECRET_KIND).pipe(Effect.mapError(() => new PluginLaunchRefused({ reason: UNREADABLE })));
      const { values, redact } = handouts(request.plugin);
      const given = entries.flatMap(({ name }) => {
        const value = values[name];
        return value === undefined || value === '' ? [] : [[name, value] as const];
      });
      return { env: Object.fromEntries(given), redact };
    }),
  };
});
