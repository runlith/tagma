import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, Exit, Scope, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { CheckoutRows, GraphDirectory } from '../../workspace/contract/service/checkouts.js';
import { FileRoots } from '../../workspace/contract/service/roots.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { FileRoot } from '../../workspace/contract/wire/roots.js';
import { HeldFeed } from '../contract/service/held.js';
import { Holdings } from '../contract/service/holdings.js';
import type { Folder } from '../holdings/judge.js';
import { stepsIn } from '@runlith/utils/sequenceDiff';
import { foldPath } from '../lines/fold.js';
import { type Judges, foldMemoryBudget, makeJudges } from '../holdings/judges.js';
import { FoldMemory } from '../lines/memory.js';
import type { Walks } from '../lines/walks.js';
import { testWalks } from './walks.js';
import { makeRetirer, type Retirer } from '../retire/driver.js';
import { makeBackground } from '../../platform/background.js';
import { makeGitMetadata } from '../record/metadata.js';
import { LineWrites } from '../contract/service/lineWrites.js';
import { idleCommands } from './doubles.js';
import type { CommandWrites } from '../record/commands.js';

const FOLD_STEPS = 2_000_000;

export const foldInline: Folder = (input, cached, alignment) => Effect.sync(() => foldPath(input, stepsIn(FOLD_STEPS), cached, alignment));

const unused = (what: string) => () => Effect.die(`the test checkout double does not answer ${what}`);

const rootsAt = (root: string): FileRoots['Service'] => {
  const at = (rootId: RootId): FileRoot => ({
    rootId,
    namespaceId: NamespaceId.make('test'),
    path: root,
    locationRevision: LocationRevision.make(0),
    witness: { provider: 'test', format: 'test', token: root },
    provenance: { kind: 'test', id: 'test' },
    git: null,
    state: 'active',
  });
  return {
    namespaceId: NamespaceId.make('test'),
    register: unused('register'),
    resolve: unused('resolve'),
    publish: unused('publish'),
    publishAll: unused('publishAll'),
    read: (rootId) => Effect.succeed(at(rootId)),
    checked: (rootId) => Effect.succeed(at(rootId)),
    checkedAll: unused('checkedAll'),
    live: unused('live'),
    active: unused('active'),
    scope: () => ({ resolve: unused('scope.resolve') }),
    resolveFootprint: unused('resolveFootprint'),
    recheck: unused('recheck'),
    retireMissing: unused('retireMissing'),
    removed: unused('removed'),
    locate: unused('locate'),
    probe: unused('probe'),
    matching: unused('matching'),
    relocate: unused('relocate'),
  };
};

const stillRows: CheckoutRows['Service'] = {
  read: unused('read'),
  refresh: unused('refresh'),
  subscribe: () => Stream.die('the test checkout double does not stream rows'),
  follow: unused('follow'),
  mark: () => Effect.void,
  onMark: () => () => undefined,
  headMoved: () => Stream.never,
  checkoutsMoved: () => Stream.never,
};

const unwritten: LineWrites['Service'] = { replace: () => Effect.succeed(false) };

export type HoldingsRig = { readonly holdings: Judges; readonly retirement: Retirer; readonly close: Effect.Effect<void> };

const rigOver = Effect.fnUntraced(function* (
  store: MachineStore['Service'],
  units: MachineUnits['Service'],
  git: Git['Service'],
  roots: FileRoots['Service'],
  checkouts: CheckoutRows['Service'],
  walks: Walks | undefined,
  publish: HeldFeed['Service']['publish'],
  writes: LineWrites['Service'],
  commands?: CommandWrites,
) {
  const scope = yield* Scope.fork(yield* Effect.scope);
  return yield* Effect.gen(function* () {
    const walking = walks ?? testWalks;
    const working = commands ?? (yield* idleCommands());
    const holdings = yield* makeJudges({
      folder: foldInline,
      walks: walking,
      memory: new FoldMemory(foldMemoryBudget()),
      metadata: yield* makeGitMetadata,
    });
    const retirement = yield* makeRetirer({ walks: walking, commands: working, background: yield* makeBackground }).pipe(
      Effect.provideService(Holdings, holdings),
    );
    return { holdings, retirement, close: Scope.close(scope, Exit.void) };
  }).pipe(
    Scope.provide(scope),
    Effect.provideService(MachineStore, store),
    Effect.provideService(MachineUnits, units),
    Effect.provideService(Git, git),
    Effect.provideService(FileRoots, roots),
    Effect.provideService(CheckoutRows, checkouts),
    Effect.provideService(GraphDirectory, '.tagma'),
    Effect.provideService(HeldFeed, { publish, heldChanged: () => () => undefined }),
    Effect.provideService(LineWrites, writes),
    Effect.provide(BunFileSystem.layer),
  );
});

export const holdingsOver = (
  store: MachineStore['Service'],
  units: MachineUnits['Service'],
  git: Git['Service'],
  root: string,
  walks?: Walks,
  publish: HeldFeed['Service']['publish'] = () => Effect.void,
  writes: LineWrites['Service'] = unwritten,
  commands?: CommandWrites,
) => rigOver(store, units, git, rootsAt(root), stillRows, walks, publish, writes, commands);

export const retiredAt = (
  store: MachineStore['Service'],
  units: MachineUnits['Service'],
  git: Git['Service'],
  root: string,
  checkout: string,
) => Effect.scoped(Effect.flatMap(holdingsOver(store, units, git, root), (rig) => rig.retirement.pass(RootId.make(checkout))));

export const retirementOver = (
  store: MachineStore['Service'],
  units: MachineUnits['Service'],
  git: Git['Service'],
  roots: FileRoots['Service'],
  checkouts: CheckoutRows['Service'],
) =>
  Effect.map(
    rigOver(store, units, git, roots, checkouts, undefined, () => Effect.void, unwritten),
    (rig) => rig.retirement,
  );
