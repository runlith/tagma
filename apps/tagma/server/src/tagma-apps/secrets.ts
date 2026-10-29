import { Effect, Schema } from 'effect';
import type { StoreFailure } from '../platform/contract/service/store.js';
import type { GateRefusal } from '../platform/contract/wire/refusal.js';
import { type SecretOwner, SecretOwnerFailed, SecretOwners } from '../secrets/contract/service/secrets.js';
import { type TagmaAppLaunchEnvironment, TagmaAppLaunchRefused, type TagmaAppLaunchRequest } from './contract/service/launch.js';
import type { TagmaAppPoint } from './contract/service/points.js';
import type { TagmaApps } from './contract/service/supervision.js';
import { tagmaApps as declaration } from './contract/wire/module.js';
import { SECRETS_POINT, SecretEntries } from './contract/wire/secrets.js';
import type { Supervisor } from './supervisor.js';

export const SECRET_KIND = declaration.id;

const isEntries = Schema.is(SecretEntries);
const NOTHING: TagmaAppLaunchEnvironment = { env: {}, redact: [] };
const UNREADABLE = 'the secret store could not be read, so its process does not start without its secrets';

const ownerFailed = (failure: StoreFailure | GateRefusal) =>
  failure._tag === 'GateRefusal'
    ? new SecretOwnerFailed({ reason: failure.reason, unblock: failure.unblock })
    : new SecretOwnerFailed({ reason: failure.message, unblock: ['repeat once the store answers'] });

export const makeShelf = Effect.fnUntraced(function* (input: { readonly apps: TagmaApps['Service']; readonly supervisor: Supervisor }) {
  const { apps, supervisor } = input;
  const owners = yield* SecretOwners;
  const declared = new Map<string, SecretEntries>();

  const owner: SecretOwner = {
    kind: SECRET_KIND,
    holders: Effect.fn('Shelf.holders')(function* (projectId: number) {
      const rows = yield* apps.list(projectId).pipe(Effect.mapError(ownerFailed));
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
    } satisfies TagmaAppPoint<SecretEntries>,
    provide: Effect.fn('Shelf.provide')(function* (request: TagmaAppLaunchRequest) {
      const entries = request.contributes[SECRETS_POINT];
      if (entries === undefined) {
        declared.delete(request.app);
        return NOTHING;
      }
      if (!isEntries(entries))
        return yield* new TagmaAppLaunchRefused({ reason: 'the secrets the app declares are not a list of secrets' });
      declared.set(request.app, entries);
      if (entries.length === 0) return NOTHING;
      const handouts = yield* owners.handout(SECRET_KIND).pipe(Effect.mapError(() => new TagmaAppLaunchRefused({ reason: UNREADABLE })));
      const { values, redact } = handouts(request.app);
      const given = entries.flatMap(({ name }) => {
        const value = values[name];
        return value === undefined || value === '' ? [] : [[name, value] as const];
      });
      return { env: Object.fromEntries(given), redact };
    }),
  };
});
