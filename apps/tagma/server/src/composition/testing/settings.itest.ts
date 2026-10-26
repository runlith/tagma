import { fixtureMigrations } from './migrations.js';
import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it, layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { Clock, Context, Effect, Exit, Layer, Scope, Stream } from 'effect';
import { GraphStore } from '../../platform/contract/service/store.js';
import { seededMachineLayer } from '../../platform/store/open.js';
import { setting } from '../../settings/testing/doubles.js';
import { project } from '../../projects/testing/doubles.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { writerRegisterLayer } from '../../platform/store/writers.js';
import { actLayer } from '../../graph/testing/doubles.js';
import { tagsLayer } from '../../graph/testing/doubles.js';
import { demoGraphLayer, tempRootEffect, withDemo } from './graphFixture.js';
import { compactionPolicy } from '../../native-harness/testing/doubles.js';
import { threadStack } from './threadParts.js';
import { mcpServers } from '../../mcp/contract/wire/settings.js';
import { performanceSpanMinMicros, performanceStorageLimit } from '../../performance/contract/wire/settings.js';
import { hostMemoryShare } from '../../executions/contract/wire/terminalBehavior.js';
import { toolOutputShare } from '../../native-harness/contract/wire/settings.js';
import { checkoutMode, commentPolicy, graphCommit } from '../../graph/testing/doubles.js';

import { makeThreadRecords } from '../../thread-record/layer.js';
import { settingsLayer } from '../../settings/layer.js';
import { settingReactionLayer } from '../../graph/testing/doubles.js';
import { Settings } from '../../settings/contract/service/values.js';
import { SettingDeclarations } from '../../settings/contract/service/declarations.js';
import { DeclaredSettings } from '../../settings/contract/service/declarations.js';
import { SETTING_DECLARATIONS } from './settings.js';
import { signedBy } from '../../invocation/testing/call.js';
import { Behaviours } from '../../graph/contract/service/behaviours.js';
import { BEHAVIOUR_REGISTRY } from '../manifest.js';
import { ENTRY_KINDS } from '../manifest.js';

const stack = settingsLayer.pipe(
  Layer.provide(Layer.succeed(DeclaredSettings, SETTING_DECLARATIONS)),
  Layer.provideMerge(settingReactionLayer()),
  Layer.provideMerge(actLayer()),
  Layer.provideMerge(Layer.mergeAll(writerRegisterLayer, tagsLayer().pipe(Layer.provide(Layer.succeed(Behaviours, BEHAVIOUR_REGISTRY))))),
  Layer.provideMerge(Layer.unwrap(Effect.map(sharedPool, (pool) => Layer.orDie(seededMachineLayer(fixtureMigrations, {}, pool))))),
);

const stand = Effect.gen(function* () {
  const context = yield* Layer.build(stack);
  const run = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E> => Effect.provide(work, context) as Effect.Effect<A, E>;
  return { context, run, settings: Context.get(context, Settings), declarations: Context.get(context, SettingDeclarations) };
});

type Stand = Effect.Success<typeof stand>;

const registered = (run: Stand['run'], names: readonly string[]) =>
  run(
    Effect.gen(function* () {
      const { db } = yield* GraphStore;
      const now = new Date(yield* Clock.currentTimeMillis);
      for (const name of names) {
        yield* db.insert(project()).values({ name, repoKey: name, rootPath: `/tmp/${name}`, createdAt: now });
      }
    }),
  );

const scoped = Effect.acquireRelease(Scope.make(), (opened) => Scope.close(opened, Exit.void));

const agent = signedBy({ harness: 'test', key: 'agent-1' });

const server = (name: string): McpServerDeclaration => ({
  name,
  transport: 'stdio',
  command: 'echo',
  capabilities: { kinds: [], mutates: false },
  enabled: true,
});

const named = (declarations: readonly McpServerDeclaration[]) => declarations.map((entry) => entry.name);

const refused = (failure: unknown, code: string) => {
  expect(failure).toBeInstanceOf(GateRefusal);
  expect((failure as GateRefusal).code).toBe(code);
};

it.effect('a live Settings value starts from persisted resolution and follows user writes and reset', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    const firstScope = yield* scoped;
    const first = yield* run(Scope.provide(settings.live(performanceStorageLimit), firstScope));
    expect(first()).toBe(performanceStorageLimit.fallback);

    yield* run(settings.write({ scope: 'user', key: performanceStorageLimit.id, value: 4_000 }));
    const storedScope = yield* scoped;
    const stored = yield* run(Scope.provide(settings.live(performanceStorageLimit), storedScope));
    expect(stored()).toBe(4_000);

    yield* run(settings.write({ scope: 'user', key: performanceStorageLimit.id, value: 5_000 }));
    expect(first()).toBe(5_000);
    expect(stored()).toBe(5_000);

    yield* run(settings.write({ scope: 'user', key: performanceStorageLimit.id, value: performanceStorageLimit.fallback }));
    expect(first()).toBe(performanceStorageLimit.fallback);
    expect(stored()).toBe(performanceStorageLimit.fallback);

    yield* Scope.close(firstScope, Exit.void);
    yield* Scope.close(storedScope, Exit.void);
  }),
);

it.effect('a live Settings value stops refreshing when its acquiring scope closes', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    const scope = yield* scoped;
    const read = yield* run(Scope.provide(settings.live(performanceStorageLimit), scope));
    yield* run(settings.write({ scope: 'user', key: performanceStorageLimit.id, value: 4_000 }));
    expect(read()).toBe(4_000);

    yield* Scope.close(scope, Exit.void);
    yield* run(settings.write({ scope: 'user', key: performanceStorageLimit.id, value: 5_000 }));
    expect(read()).toBe(4_000);
  }),
);

it.effect('a live Settings value refuses a project override for process telemetry', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    const failure = yield* run(
      Effect.flip(settings.write({ scope: 'project', projectId: 1, key: performanceStorageLimit.id, value: 4_000 })),
    );
    refused(failure, 'setting-scope');
  }),
);

it.effect('the tool-output protection share refuses values outside the slider bounds and accepts both endpoints', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    for (const value of [0, -0.1, 0.009_999, 0.900_001, 1]) {
      const failure = yield* run(Effect.flip(settings.write({ scope: 'user', key: toolOutputShare.id, value })));
      refused(failure, 'setting-value');
    }
    yield* run(settings.write({ scope: 'user', key: toolOutputShare.id, value: 0.01 }));
    expect(yield* run(settings.value(toolOutputShare))).toBe(0.01);
    yield* run(settings.write({ scope: 'user', key: toolOutputShare.id, value: 0.9 }));
    expect(yield* run(settings.value(toolOutputShare))).toBe(0.9);
  }),
);

it.effect('the tool-output protection share: the narrow value agrees with the catalog read for project rows and user fallback', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    yield* registered(run, ['one', 'two', 'three']);
    yield* run(settings.write({ scope: 'user', key: toolOutputShare.id, value: 0.25 }));
    yield* run(settings.write({ scope: 'project', projectId: 1, key: toolOutputShare.id, value: 0.2 }));
    yield* run(settings.write({ scope: 'project', projectId: 2, key: toolOutputShare.id, value: 0.3 }));

    for (const [projectId, expected] of [
      [1, 0.2],
      [2, 0.3],
      [3, 0.25],
    ] as const) {
      expect(yield* run(settings.value(toolOutputShare, projectId))).toBe(expected);
      expect((yield* run(settings.read(toolOutputShare, projectId))).value).toBe(expected);
    }

    yield* run(settings.write({ scope: 'project', projectId: 1, key: toolOutputShare.id, value: 0.4 }));
    expect(yield* run(settings.value(toolOutputShare, 1))).toBe(0.4);
  }),
);

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('the compaction policy', (compaction) => {
  compaction.effect('the compaction policy resolves the pruning share from each thread own project', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const run = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E> =>
          Effect.provide(work, demo.context) as Effect.Effect<A, E>;
        const settings = Context.get(demo.context, Settings);
        const secondProject = yield* run(
          demo.graph.projectLifecycle.create({
            name: 'settings-policy-two',
            rootPath: yield* tempRootEffect(demo.fixture, 'settings-policy-two-'),
          }),
        );
        const records = yield* run(makeThreadRecords);
        const { store, threads } = yield* run(
          threadStack({ db: demo.graph.store.db, units: demo.graph.units, records, kinds: ENTRY_KINDS }),
        );

        const [firstId, secondId] = yield* demo.graph.units
          .write('Settings', (unit) =>
            Effect.gen(function* () {
              const first = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
              const second = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
              yield* threads.rows.attachFacet({ threadId: first.id, projectId: demo.projectId }, unit);
              yield* threads.rows.attachFacet({ threadId: second.id, projectId: secondProject.id }, unit);
              return [first.id, second.id] as const;
            }),
          )
          .pipe(Effect.orDie);
        yield* run(settings.write({ scope: 'project', projectId: demo.projectId, key: toolOutputShare.id, value: 0.2 }));
        yield* run(settings.write({ scope: 'project', projectId: secondProject.id, key: toolOutputShare.id, value: 0.3 }));

        expect((yield* compactionPolicy(records, settings, firstId)).toolPruneProtectShare).toBe(0.2);
        expect((yield* compactionPolicy(records, settings, secondId)).toolPruneProtectShare).toBe(0.3);
        const missing = yield* Effect.flip(compactionPolicy(records, settings, 'missing-facet'));
        expect(missing).toBeInstanceOf(ThreadNotFoundError);
        expect((missing as ThreadNotFoundError).threadId).toBe('missing-facet');
      }),
    ),
  );
});

it.effect('the checkout model resolves user to project, projects the choice, and stays closed to an agent', () =>
  Effect.gen(function* () {
    const { run, settings, declarations } = yield* stand;
    yield* registered(run, ['shared-project', 'single-project']);

    yield* run(settings.write({ scope: 'user', key: checkoutMode().id, value: 'single' }));
    yield* run(settings.write({ scope: 'project', projectId: 1, key: checkoutMode().id, value: 'shared' }));

    expect(yield* run(settings.value(checkoutMode(), 1))).toBe('shared');
    expect(yield* run(settings.value(checkoutMode(), 2))).toBe('single');
    expect((yield* run(declarations.read(1))).entries.find((entry) => entry.id === checkoutMode().id)).toMatchObject({
      value: 'shared',
      from: 'project',
      scopes: ['user', 'project'],
      control: { kind: 'choice', choices: [{ value: 'shared' }, { value: 'single' }] },
      fallback: 'shared',
      layers: { user: { value: 'single', declined: false }, project: { value: 'shared', declined: false } },
    });

    yield* run(settings.write({ scope: 'project', projectId: 1, key: checkoutMode().id, value: 'shared' }).pipe(agent));
    expect((yield* run(declarations.read(1))).entries.find((entry) => entry.id === checkoutMode().id)).toMatchObject({
      value: 'shared',
      from: 'project',
      writer: { harness: 'test', key: 'agent-1' },
    });
  }),
);

it.effect('who commits the tree answers auto until one project says otherwise, and refuses a machine-wide default', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    yield* registered(run, ['one', 'two']);
    expect((yield* run(settings.read(graphCommit(), 1))).value).toBe('auto');

    yield* run(settings.write({ scope: 'project', projectId: 1, key: graphCommit().id, value: 'manual' }));
    expect((yield* run(settings.read(graphCommit(), 1))).value).toBe('manual');
    expect((yield* run(settings.read(graphCommit(), 2))).value).toBe('auto');

    refused(yield* run(Effect.flip(settings.write({ scope: 'user', key: graphCommit().id, value: 'manual' }))), 'setting-scope');
  }),
);

it.effect('who commits the tree holds three positions and nothing else', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    refused(
      yield* run(Effect.flip(settings.write({ scope: 'project', projectId: 1, key: graphCommit().id, value: 'sometimes' }))),
      'setting-value',
    );
  }),
);

it.effect('where an agent writes: a machine budget in user scope, and the row remembers the session', () =>
  Effect.gen(function* () {
    const { run, settings, declarations } = yield* stand;
    yield* run(settings.write({ scope: 'user', key: performanceStorageLimit.id, value: 4_000 }).pipe(agent));
    const entry = (yield* run(declarations.read())).entries.find((row) => row.id === performanceStorageLimit.id);
    expect(entry?.value).toBe(4_000);
    expect(entry?.writer).toEqual({ harness: 'test', key: 'agent-1' });
  }),
);

it.effect('where an agent writes: the user default of a key its project can answer', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    yield* run(settings.write({ scope: 'user', key: toolOutputShare.id, value: 0.4 }).pipe(agent));
    expect(yield* run(settings.value(toolOutputShare))).toBe(0.4);
  }),
);

it.effect('where an agent writes: a machine-only key in user scope', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    yield* run(settings.write({ scope: 'user', key: hostMemoryShare.id, value: 0.3 }).pipe(agent));
    expect((yield* run(settings.read(hostMemoryShare, 1))).value).toBe(0.3);
  }),
);

it.effect('where an agent writes: the comment law of its own project', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    yield* registered(run, ['commented']);
    yield* run(settings.write({ scope: 'project', projectId: 1, key: commentPolicy().id, value: 'forbid' }).pipe(agent));
    expect((yield* run(settings.read(commentPolicy(), 1))).value).toBe('forbid');
  }),
);

it.effect('where an agent writes: an unsigned call records no writer', () =>
  Effect.gen(function* () {
    const { run, settings, declarations } = yield* stand;
    yield* run(settings.write({ scope: 'user', key: performanceStorageLimit.id, value: 4_000 }));
    const catalog = yield* run(declarations.read());
    const entry = catalog.entries.find((row) => row.id === performanceStorageLimit.id);
    expect(entry?.value).toBe(4_000);
    expect(entry?.writer).toBeUndefined();
  }),
);

it.effect('amending a declaration list: two additions landing together both stand, each derived from its own scope', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    yield* registered(run, ['mcp-concurrent']);
    yield* run(settings.amend(mcpServers, 'user', undefined, (current) => Effect.succeed([...current, server('operator')])));

    yield* run(
      Effect.all(
        [
          settings.amend(mcpServers, 'project', 1, (current) => Effect.succeed([...current, server('files')])),
          settings.amend(mcpServers, 'project', 1, (current) => Effect.succeed([...current, server('search')])),
        ],
        { concurrency: 'unbounded' },
      ),
    );

    const resolved = yield* run(settings.read(mcpServers, 1));
    expect([...named(resolved.value)].sort()).toEqual(['files', 'operator', 'search']);
    expect(resolved.from).toBe('project');
  }),
);

it.effect('amending a declaration list: an amendment moves what it can read and leaves an unreadable member exactly as stored', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    yield* registered(run, ['mcp-unreadable']);
    const illegal = { ...server('context7'), name: 'My__Files' };
    yield* run(
      Effect.gen(function* () {
        const { db } = yield* GraphStore;
        const now = new Date(yield* Clock.currentTimeMillis);
        yield* db.insert(setting()).values({
          scope: 'project',
          projectId: 1,
          key: mcpServers.id,
          value: JSON.stringify([illegal, server('context7')]),
          declined: false,
          updatedAt: now,
        });
      }),
    );

    const resolved = yield* run(settings.read(mcpServers, 1));
    expect(named(resolved.value)).toEqual(['context7']);
    expect(resolved.rejections).toHaveLength(1);

    yield* run(settings.amend(mcpServers, 'project', 1, (current) => Effect.succeed([...current, server('files')])));
    const after = yield* run(settings.read(mcpServers, 1));
    expect(named(after.value)).toEqual(['context7', 'files']);
    expect(after.rejections).toHaveLength(1);
    expect(after.rejections[0]?.reason).toContain('My__Files');
  }),
);

it.effect('amending a declaration list: a derivation that refuses leaves the row as it stood', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    yield* registered(run, ['mcp-refused']);
    yield* run(settings.amend(mcpServers, 'project', 1, (current) => Effect.succeed([...current, server('files')])));

    const failure = yield* run(
      Effect.flip(
        settings.amend(mcpServers, 'project', 1, (current) =>
          current.some((entry) => entry.name === 'files')
            ? Effect.fail(new GateRefusal('mcp-server-exists', 'files is already declared here.', ['name another']))
            : Effect.succeed([...current, server('files')]),
        ),
      ),
    );
    refused(failure, 'mcp-server-exists');
    expect(named((yield* run(settings.read(mcpServers, 1))).value)).toEqual(['files']);
  }),
);

it.effect('amending a declaration list: an agent amends the user list as it amends a project list', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    yield* run(settings.amend(mcpServers, 'user', undefined, (current) => Effect.succeed([...current, server('files')])).pipe(agent));
    expect(named((yield* run(settings.read(mcpServers, 1))).value)).toEqual(['files']);
  }),
);

it.effect('a Settings change stream answers the value standing when it was acquired, then the value a user write left', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    const scope = yield* scoped;
    const shares = yield* run(Scope.provide(settings.changes(hostMemoryShare), scope));
    yield* run(settings.write({ scope: 'user', key: hostMemoryShare.id, value: 0.5 }));
    const seen = yield* run(Stream.runCollect(Stream.take(shares, 2)));

    expect(seen).toEqual([hostMemoryShare.fallback, 0.5]);

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect('a Settings change stream carries its own key alone, so a neighbour’s write is not a change of this one', () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    const scope = yield* scoped;
    const shares = yield* run(Scope.provide(settings.changes(hostMemoryShare), scope));
    yield* run(settings.write({ scope: 'user', key: performanceStorageLimit.id, value: 4_000 }));
    yield* run(settings.write({ scope: 'user', key: hostMemoryShare.id, value: 0.5 }));
    const seen = yield* run(Stream.runCollect(Stream.take(shares, 2)));

    expect(seen).toEqual([hostMemoryShare.fallback, 0.5]);

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect('the span record floor is catalogued and follows user writes and reset', () =>
  Effect.gen(function* () {
    const { run, settings, declarations } = yield* stand;
    const entry = declarations.read().pipe(Effect.map((catalog) => catalog.entries.find((row) => row.id === performanceSpanMinMicros.id)));

    expect(yield* run(entry)).toMatchObject({
      value: performanceSpanMinMicros.fallback,
      from: 'default',
      scopes: ['user'],
    });
    yield* run(settings.write({ scope: 'user', key: performanceSpanMinMicros.id, value: 27 }));
    expect(yield* run(entry)).toMatchObject({ value: 27, from: 'user' });
    yield* run(settings.write({ scope: 'user', key: performanceSpanMinMicros.id }));
    expect(yield* run(entry)).toMatchObject({
      value: performanceSpanMinMicros.fallback,
      from: 'default',
    });
  }),
);

it.effect("a project's held Settings value follows its own project, the user default beneath it, and no other project", () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    yield* registered(run, ['held-one', 'held-two']);
    const one = yield* run(settings.held(commentPolicy(), 1));
    const two = yield* run(settings.held(commentPolicy(), 2));
    expect(one()).toBe(commentPolicy().fallback);

    yield* run(settings.write({ scope: 'project', projectId: 1, key: commentPolicy().id, value: 'forbid' }));
    expect(one()).toBe('forbid');
    expect(two()).toBe(commentPolicy().fallback);

    yield* run(settings.write({ scope: 'user', key: commentPolicy().id, value: 'forbid' }));
    expect(two()).toBe('forbid');

    yield* run(settings.write({ scope: 'project', projectId: 1, key: commentPolicy().id }));
    expect(one()).toBe('forbid');

    yield* run(settings.write({ scope: 'user', key: commentPolicy().id }));
    expect(one()).toBe(commentPolicy().fallback);
    expect(two()).toBe(commentPolicy().fallback);
  }),
);

it.effect("a project's held Settings value is one reading per project, resolved once and answered again", () =>
  Effect.gen(function* () {
    const { run, settings } = yield* stand;
    yield* registered(run, ['held-once']);
    const first = yield* run(settings.held(commentPolicy(), 1));
    const again = yield* run(settings.held(commentPolicy(), 1));
    expect(again).toBe(first);
  }),
);
