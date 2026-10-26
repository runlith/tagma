import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { builtinRegistry } from '../providerCatalog.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { Context, Effect, Layer } from 'effect';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { unmeasuredObservation, asHarnessObservation, modelChanges } from '../../../threads/testing/doubles.js';
import { harnessAdapter, harnessOccasion, harnessReport } from '../../../external-harnesses/contract/service/table.js';
import { asHarnessName } from '../../../threads/testing/doubles.js';
import { asThreadListProjection } from '../../../threads/testing/doubles.js';
import { wireThread, wireThreadFacts } from '../../../threads/testing/doubles.js';
import { asWarmthBasis } from '../../../threads/testing/doubles.js';
import { HarnessObservations, terminalArgv } from '../../../external-harnesses/testing/doubles.js';
import { sessionStoreOver } from '../../../external-harnesses/testing/floor.js';
import type { HarnessEvent } from '../../../threads/contract/wire/harness/observation.js';

const setup = Effect.fnUntraced(function* () {
  const catalog = yield* (yield* ProviderRegistry).catalog;
  const NO_BASIS = {
    warmth: { curves: new Map(), accounts: new Map(), models: catalog.models } satisfies ReturnType<typeof asWarmthBasis>,
    limits: new Map(),
  };
  const demo = yield* threadStoreFixture;
  const raise = Effect.fnUntraced(function* (name: ReturnType<typeof asHarnessName>, key: string | null) {
    const { records, store, threads } = demo;
    const published: string[] = [];
    const facets = yield* sessionStoreOver(
      demo.db,
      demo.units,
      threads.spells,
      records,
      yield* Effect.provide(modelChanges(), demo.context),
      (id) =>
        Effect.sync(() => {
          published.push(id);
        }),
    );
    const observations = new HarnessObservations(facets, demo.db, demo.units, records, () => Effect.void);
    const threadId = yield* demo.units.write('harnessAcceptance.threadId', (unit) =>
      Effect.gen(function* () {
        const row = yield* store.insert({ ownerId: 'operator', agentId: 'harness' }, unit);
        yield* threads.rows.attachFacet(
          {
            threadId: row.id,
            projectId: demo.projectId,
            harness: {
              facet: { name, sessionKey: key, execution: null, observation: unmeasuredObservation() },
              kernel: null,
            },
          },
          unit,
        );
        return row.id;
      }),
    );
    yield* facets.open(threadId, '', 'owner', terminalArgv(catalog.models, ''));
    yield* facets.change(threadId, (facet) =>
      Effect.succeed({
        facet: {
          ...facet,
          execution: { execution: `exec-${threadId.slice(0, 8)}`, incarnation: 1 },
          session: facet.session === undefined ? facet.session : { ...facet.session, state: 'running' as const },
        },
        value: undefined,
      }),
    );
    published.length = 0;
    const post = Effect.fnUntraced(function* (payload: Record<string, unknown>, minute: number, over: Record<string, unknown> = {}) {
      const adapter = harnessAdapter(name);
      const read = harnessReport(adapter, { ...payload, ...over });
      const named = (payload.hook_event_name ?? payload.hookEventName) as string;
      const occasion = harnessOccasion(name, {
        name: named,
        tool: (payload.tool_name ?? payload.toolName) as string | undefined,
        notification: payload.notification_type as string | undefined,
      });
      const facet = yield* facets.read(threadId);
      const scope = { rootKey: read.sessionKey, turnId: read.turnId };
      const said = read.model;
      const model =
        said === null
          ? adapter.reportsModel
            ? { _tag: 'NotRead' as const }
            : { _tag: 'Unsupported' as const, source: 'hook' as const, scope, observedAt: at(minute) }
          : said.read === 'value'
            ? { _tag: 'Value' as const, value: said.value, claim: said.claim, source: 'hook' as const, scope, observedAt: at(minute) }
            : {
                _tag: said.read === 'absent' ? ('Absent' as const) : ('Unsupported' as const),
                source: 'hook' as const,
                scope,
                observedAt: at(minute),
              };
      return yield* accept({
        occasion,
        observedAt: at(minute),
        childId: (payload.agent_id ?? over.agent_id) === undefined ? undefined : String(payload.agent_id ?? over.agent_id),
        sessionId: facet?.session?.id ?? null,
        rootKey: read.sessionKey,
        turnId: read.turnId === read.sessionKey ? null : read.turnId,
        receipt: null,
        atRevision: null,
        model,
      });
    });
    const accept = (event: HarnessEvent) =>
      facets.change(threadId, (facet) => {
        const admitted = observations.admit(facet, event);
        return Effect.succeed({ facet: admitted.facet, value: admitted });
      });
    const reading = Effect.fnUntraced(function* () {
      return (yield* observations.read(threadId))!;
    });
    const summary = () => threads.list.summary(threadId);
    const wire = Effect.fnUntraced(function* () {
      const row = (yield* summary()) as ReturnType<typeof asThreadListProjection> | undefined;
      if (!row) return yield* Effect.die(new Error('thread gone'));
      return wireThread({ ...row, phase: null, held: { paths: 0, unproven: 0 } }, NO_BASIS);
    });
    const facts = Effect.fnUntraced(function* () {
      const row = (yield* summary()) as ReturnType<typeof asThreadListProjection>;
      return wireThreadFacts({ ...row, phase: null, held: { paths: 0, unproven: 0 } });
    });
    return { facets, observations, threadId, post, accept, reading, summary, wire, facts, published };
  });
  return { raise, catalog };
});

const at = (minute: number): string => new Date(Date.UTC(2026, 8, 13, 10, minute)).toISOString();

const devinRoot = 'devin-root';
const devinStart = { hook_event_name: 'SessionStart', source: 'startup', session_id: devinRoot };
const devinPrompt = { hook_event_name: 'UserPromptSubmit', session_id: devinRoot, prompt_id: 'devin-turn' };

class World extends Context.Service<World, Effect.Success<ReturnType<typeof setup>>>()('testing/HarnessAcceptanceWorld') {}

layer(Layer.effect(World, setup()).pipe(Layer.provide(builtinRegistry)), { excludeTestServices: true })('harness event admission', (it) => {
  it.effect(
    'a vendor child event never moves the bound root',
    Effect.fnUntraced(function* () {
      const { raise } = yield* World;
      const world = yield* raise('devin', devinRoot);
      yield* world.post(devinStart, 0);
      expect((yield* world.reading()).binding.rootKey).toBe(devinRoot);
      const refused = yield* world.post(devinPrompt, 1, { agent_id: 'vendor-child-9' });
      expect(refused.receipt).toMatchObject({ outcome: 'refused', cause: 'child-event' });
      expect((yield* world.reading()).binding.rootKey).toBe(devinRoot);
    }),
  );

  it.effect(
    'a replacement refuses the previous execution read',
    Effect.fnUntraced(function* () {
      const { raise } = yield* World;
      const world = yield* raise('devin', devinRoot);
      yield* world.post(devinStart, 0);
      expect((yield* world.reading()).binding.rootKey).toBe(devinRoot);
      const before = yield* world.facets.read(world.threadId);
      yield* world.facets.change(world.threadId, (facet) =>
        Effect.succeed({
          facet: facet.session === undefined ? facet : { ...facet, session: { ...facet.session, state: 'ended' as const } },
          value: undefined,
        }),
      );
      yield* world.facets.open(world.threadId, '', 'owner', terminalArgv((yield* World).catalog.models, ''));
      const late = yield* world.accept({
        occasion: 'turn-start',
        observedAt: at(1),
        sessionId: before?.session?.id ?? null,
        rootKey: devinRoot,
        turnId: 'turn-old',
        receipt: null,
        atRevision: null,
        model: { _tag: 'NotRead' },
      });
      expect(late.receipt).toMatchObject({ outcome: 'refused', cause: 'stale-execution' });
    }),
  );

  it.effect(
    'a fresh root with no launch key stays unproven and honest',
    Effect.fnUntraced(function* () {
      const { raise } = yield* World;
      const world = yield* raise('devin', null);
      const landed = yield* world.post(devinStart, 0);
      expect(landed.receipt.cause).toBe('root-unproven');
      expect((yield* world.reading()).binding.rootKey).toBeNull();
      expect((yield* world.wire()).harness?.model).toBeNull();
    }),
  );
});
