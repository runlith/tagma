import { Context, Data, Deferred, Effect, Scope } from 'effect';
import { approvalModesLayer } from '@runlith/agent/modes/ApprovalModes';
import type { OperationPair } from '../platform/contract/service/body.js';
import type { MigrationChain } from '../platform/contract/service/store.js';
import { StoreSnapshots } from '../platform/contract/service/snapshots.js';
import { GrantSigner } from '../platform/contract/service/grantSigner.js';
import { SessionIdentity } from '../platform/contract/wire/session.js';
import { Maintenance } from '../platform/contract/service/maintenance.js';
import { Background } from '../platform/contract/service/background.js';
import { makeBackground } from '../platform/background.js';
import type { SettingKey } from '../platform/contract/wire/setting.js';
import { CHECKOUT_DIRECTORY } from '../graph/contract/wire/storage.js';
import { GraphDirectory } from '../workspace/contract/service/checkouts.js';
import { OperationCatalog } from '../invocation/contract/service/catalog.js';
import { operationCatalog } from './operationCatalog.js';
import { OperationSubjects } from '../enforcement/contract/service/operationSubjects.js';
import { checkSubjectOf } from './catalog.js';

export class AssemblyInvalid extends Data.TaggedError('AssemblyInvalid')<{
  readonly unregistered: readonly { readonly key: string; readonly by: string }[];
  readonly ports: readonly string[];
}> {
  override get message(): string {
    if (this.ports.length > 0) return `mandatory ports are not bound: ${this.ports.join(', ')}`;
    const named = this.unregistered.map(({ key, by }) => `${key} is managed by ${by}`).join('; ');
    return `no operation registers the managers of these settings, so nobody could write them: ${named}`;
  }
}

export const projectedBodies = <const Ps extends Readonly<Record<string, OperationPair>>>(
  pairs: Ps,
): { readonly [K in keyof Ps]: Ps[K]['body'] & { readonly id: K } } =>
  Object.fromEntries(Object.entries(pairs).map(([id, { body }]) => [id, { ...body, id }])) as never;

export type Started = {
  readonly migrations: MigrationChain<'machine'>;
  readonly graphMigrations: MigrationChain<'graph'>;
  readonly bindings: Context.Context<
    SessionIdentity | GrantSigner | StoreSnapshots | GraphDirectory | OperationCatalog | OperationSubjects | Maintenance | Background
  >;
  readonly maintenance: Deferred.Deferred<void>;
  readonly scope: Scope.Closeable;
};

export const start = Effect.fn('composition.start')(function* (
  folder: string,
  seeds: string,
  identity: SessionIdentity['Service'],
  grants: GrantSigner['Service'],
  settings: readonly SettingKey<unknown>[],
  operations: readonly string[],
  snapshots: StoreSnapshots['Service'],
): Effect.fn.Return<Started, AssemblyInvalid> {
  const registered = new Set(operations);
  const unregistered = settings.flatMap(({ id, control }) =>
    control?.kind === 'managed' && !registered.has(control.by) ? [{ key: id, by: control.by }] : [],
  );
  if (unregistered.length > 0) return yield* new AssemblyInvalid({ unregistered, ports: [] });
  const maintenance = yield* Deferred.make<void>();
  const graphMigrations: MigrationChain<'graph'> = { folder, seeds, snapshots };
  return {
    migrations: { folder, seeds, snapshots },
    graphMigrations,
    bindings: Context.make(SessionIdentity, identity).pipe(
      Context.add(GrantSigner, grants),
      Context.add(StoreSnapshots, snapshots),
      Context.add(GraphDirectory, CHECKOUT_DIRECTORY),
      Context.add(OperationCatalog, yield* Effect.provide(operationCatalog, approvalModesLayer)),
      Context.add(OperationSubjects, { of: checkSubjectOf }),
      Context.add(Maintenance, { opened: Deferred.await(maintenance), isOpen: Deferred.isDone(maintenance) }),
      Context.add(Background, yield* makeBackground),
    ),
    maintenance,
    scope: yield* Scope.make(),
  };
});
