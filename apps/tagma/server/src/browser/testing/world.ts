import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Clock, Context, Effect, FileSystem, Layer } from 'effect';
import { migrationsFolder, seedDirectory } from '../../installation/testing/doubles.js';
import { forProject } from '../../invocation/testing/call.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { storeLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { unitsLayer } from '../../platform/store/units.js';
import type { CurrentProject } from '../../projects/contract/service/caller.js';
import type { Projects } from '../../projects/contract/service/registry.js';
import { projectsLayer } from '../../projects/testing/doubles.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { ServedOrigins, sourceRoots } from './sourceRoots.js';
import { fixedCheckoutPaths } from '../../workspace/testing/doubles.js';
import { project } from '../../projects/store/table.js';
import { Settings } from '../../settings/contract/service/values.js';
import { resolveSetting, type SettingLayer } from '../../settings/resolution.js';
import { ProfileId } from '../contract/wire/ids.js';
import type { Automation } from '../contract/service/automation.js';
import { type HostAdapter, HostAdapters, type Hosts } from '../contract/service/hosts.js';
import type { Pages } from '../contract/service/pages.js';
import { BrowserPlace } from '../contract/service/place.js';
import type { Profiles } from '../contract/service/profiles.js';
import { RunEnds, runsLayer } from './runs.js';
import type { Screencast } from '../contract/service/screencast.js';
import { browserLayer } from '../layer.js';
import { COOKIE_PAIRS, PAGE_PAIRS } from '../operations.js';

const settings = Layer.effect(
  Settings,
  Effect.sync(() => {
    const values = new Map<string, Map<string, unknown>>();
    const chain = (projectId?: number): SettingLayer[] => [
      { scope: 'user', values: values.get('user') ?? new Map(), declined: new Set(), writers: new Map() },
      { scope: 'project', values: values.get(`project:${projectId}`) ?? new Map(), declined: new Set(), writers: new Map() },
    ];
    return Settings.of({
      value: (key, projectId) => Effect.sync(() => resolveSetting(key, chain(projectId)).value),
      read: (key, projectId) => Effect.sync(() => resolveSetting(key, chain(projectId))),
      chain: () => Effect.die('settings are not chained here'),
      live: () => Effect.die('settings are not watched here'),
      held: (key, projectId) => Effect.succeed(() => resolveSetting(key, chain(projectId)).value),
      changes: () => Effect.die('settings are not watched here'),
      write: (input) =>
        Effect.sync(() => {
          const at = input.scope === 'user' ? 'user' : `project:${input.projectId}`;
          const layer = values.get(at) ?? new Map<string, unknown>();
          values.set(at, layer);
          if (input.value === undefined) layer.delete(input.key);
          else layer.set(input.key, input.value);
        }),
      amend: () => Effect.die('settings are not amended here'),
    });
  }),
);

export class Seeded extends Context.Service<Seeded, { readonly id: number; readonly name: string }>()('tagma/browser/Seeded') {}

export const PAGE = PAGE_PAIRS;

export const COOKIE = COOKIE_PAIRS;

export type Served = Pages | Automation | Screencast | Profiles | Seeded | Projects | RunEnds | Settings | ServedOrigins;

export type BrowserFixture = { readonly home: string; readonly services: Context.Context<Served | Hosts> };

export const calling = <A, E>(work: Effect.Effect<A, E, unknown>): Effect.Effect<A, E, Served> =>
  Effect.flatMap(Seeded, (seeded) =>
    (work as Effect.Effect<A, E, CurrentProject | Served>).pipe(
      forProject(Effect.succeed({ project: { id: seeded.id, name: seeded.name } })),
    ),
  );

export const refusalOf = <A, E>(work: Effect.Effect<A, E, Served>) =>
  Effect.map(Effect.flip(work), (failure) => {
    const refused = failure as unknown as GateRefusal;
    return { code: refused.code, reason: refused.reason, unblock: refused.unblock };
  });

export const refIn = (text: string, line: RegExp): string => {
  const found = text.split('\n').find((held) => line.test(held));
  const ref = found === undefined ? undefined : /\[ref=(e\d+)\]/.exec(found)?.[1];
  if (ref === undefined) throw new Error(`no line matching ${line} holds a ref in:\n${text}`);
  return ref;
};

export const agentIn = (home: string): Caller => ({
  actor: { kind: 'thread', threadId: 'agent', projectId: 1, principalId: 'agent', session: { harness: 'tagma', key: 'agent' } },
  files: { path: home, resolve: (candidate) => join(home, candidate) },
});

export const OPERATOR: Caller = { actor: { kind: 'operator' }, files: null };

export const absentAdapter = (adapter: HostAdapter): HostAdapter => ({
  ...adapter,
  id: 'absent',
  title: 'A host that never connects',
  seeds: [{ id: ProfileId.make('absent-agent'), name: 'Absent agent', document: adapter.fallback }],
});

export type WorldInput = {
  readonly host: Layer.Layer<never, never, Hosts>;
  readonly adapters: readonly HostAdapter[];
  readonly home: string;
  readonly store?: string;
};

export const browserWorld = (input: WorldInput) => {
  const migrations = { folder: migrationsFolder(), seeds: seedDirectory() };
  const projected = Layer.effect(
    Seeded,
    Effect.gen(function* () {
      const { db } = yield* MachineStore;
      const standing = yield* db.select().from(project).where(eq(project.rootPath, input.home)).limit(1).get();
      if (standing !== undefined) return Seeded.of({ id: standing.id, name: standing.name });
      const createdAt = new Date(yield* Clock.currentTimeMillis);
      const row = yield* db
        .insert(project)
        .values({ name: 'browser', repoKey: input.home, rootPath: input.home, createdAt })
        .returning()
        .get();
      return Seeded.of({ id: row!.id, name: row!.name });
    }),
  );
  return input.host.pipe(
    Layer.provideMerge(browserLayer),
    Layer.provideMerge(
      Layer.effect(
        CheckoutPaths,
        Effect.gen(function* () {
          const { id } = yield* Seeded;
          const files = yield* FileSystem.FileSystem;
          yield* files.makeDirectory(join(input.home, 'dev'), { recursive: true });
          yield* files.makeDirectory(join(input.home, 'frame'), { recursive: true });
          return yield* fixedCheckoutPaths(id, [
            { checkout: 'main', root: input.home },
            { checkout: 'dev', root: join(input.home, 'dev') },
            { checkout: 'frame', root: join(input.home, 'frame') },
          ]);
        }),
      ),
    ),
    Layer.provideMerge(projected),
    Layer.provideMerge(projectsLayer()),
    Layer.provideMerge(runsLayer),
    Layer.provideMerge(sourceRoots(input.home)),
    Layer.provideMerge(settings),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HostAdapters, { all: input.adapters }),
        Layer.succeed(BrowserPlace, { root: join(input.home, 'browser') }),
        BunFileSystem.layer,
        BunPath.layer,
      ),
    ),
    Layer.provideMerge(
      unitsLayer(MachineUnits, MachineStore).pipe(
        Layer.provideMerge(
          Layer.unwrap(
            Effect.map(sharedPool, (pool) =>
              storeLayer(MachineStore, input.store ?? join(input.home, 'tagma.sqlite'), migrations, { readers: 0, durable: false }, pool),
            ),
          ),
        ),
      ),
    ),
  );
};
