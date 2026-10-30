import { modelChanges } from '../../../threads/testing/doubles.js';
import { builtinRegistry } from '../providerCatalog.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { unmeasuredObservation, asHarnessObservation } from '../../../threads/testing/doubles.js';
import { threadFactsLine, threadShapeText } from '../../../threads/testing/doubles.js';
import { asThreadListProjection } from '../../../threads/testing/doubles.js';
import { wireThread, wireThreadFacts, wireThreadShape } from '../../../threads/testing/doubles.js';
import { asWarmthBasis } from '../../../threads/testing/doubles.js';
import { HarnessObservations, terminalArgv } from '../../../external-harnesses/testing/doubles.js';
import { sessionStoreOver } from '../../../external-harnesses/testing/floor.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';
import { shippedAdapters } from '../external-harnesses/shipped.js';
import type { HarnessEvent } from '../../../threads/contract/wire/harness/observation.js';

const setup = Effect.fnUntraced(function* () {
  const catalog = yield* (yield* ProviderRegistry).catalog;
  const adapters = yield* shippedAdapters;
  const NO_BASIS = {
    warmth: { curves: new Map(), accounts: new Map(), models: catalog.models } satisfies ReturnType<typeof asWarmthBasis>,
    limits: new Map(),
  };
  const demo = yield* threadStoreFixture;
  const raise = Effect.fnUntraced(function* () {
    const { records, store, threads } = demo;
    const facets = yield* sessionStoreOver(
      demo.db,
      demo.units,
      threads.spells,
      records,
      yield* Effect.provide(modelChanges(), demo.context),
      () => Effect.void,
    );
    const observations = new HarnessObservations(facets, demo.db, demo.units, records, () => Effect.void);
    const threadId = yield* demo.units.write('harnessReaders.threadId', (unit) =>
      Effect.gen(function* () {
        const row = yield* store.insert({ ownerId: 'operator', agentId: 'harness' }, unit);
        yield* threads.rows.attachFacet(
          {
            threadId: row.id,
            projectId: demo.projectId,
            harness: {
              facet: {
                name: 'cursor',
                presentation: harnessPresentation(builtinHarness('cursor')),
                sessionKey: ROOT,
                execution: null,
                observation: unmeasuredObservation(),
              },
              kernel: null,
            },
          },
          unit,
        );
        return row.id;
      }),
    );
    yield* facets.open(threadId, '', 'owner', terminalArgv(adapters, catalog.models, ''));
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
    const post = Effect.fnUntraced(function* (minute: number, over: Record<string, unknown> = {}) {
      const facet = yield* facets.read(threadId);
      return yield* facets.change(threadId, (standing) => {
        const admitted = observations.admit(
          standing,
          {
            occasion: 'session-start',
            observedAt: at(minute),
            sessionId: facet?.session?.id ?? null,
            rootKey: ROOT,
            turnId: null,
            receipt: null,
            atRevision: null,
            model: { _tag: 'NotRead' },
            ...over,
          } as HarnessEvent,
          builtinHarness('cursor'),
        );
        return Effect.succeed({ facet: admitted.facet, value: admitted });
      });
    });
    const reading = Effect.fnUntraced(function* () {
      return (yield* observations.read(threadId))!;
    });
    const summary = () => threads.list.summary(threadId);
    const order = Effect.fnUntraced(function* () {
      return (yield* summary())?.readerOrderAt ?? null;
    });
    const wire = Effect.fnUntraced(function* () {
      const row = (yield* summary()) as ReturnType<typeof asThreadListProjection> | undefined;
      if (!row) return yield* Effect.die(new Error('thread gone'));
      return wireThread({ ...row, phase: null, held: { paths: 0, unproven: 0 } }, NO_BASIS);
    });
    return { threads, facets, observations, threadId, post, reading, summary, order, wire };
  });
  return { raise, basis: NO_BASIS };
});

const at = (minute: number): string => new Date(Date.UTC(2026, 8, 13, 10, minute)).toISOString();
const ROOT = 'vendor-root-1';

class World extends Context.Service<World, Effect.Success<ReturnType<typeof setup>>>()('testing/HarnessReadersWorld') {}

layer(Layer.effect(World, setup()).pipe(Layer.provide(builtinRegistry)), { excludeTestServices: true })(
  'harness observation readers',
  (it) => {
    it.effect(
      'a sourced model and a refusal read the same on the wire, the shape and their lines',
      Effect.fnUntraced(function* () {
        const { raise, basis } = yield* World;
        const world = yield* raise();
        yield* world.post(0);
        yield* world.post(1, {
          occasion: 'self-description',
          model: {
            _tag: 'Value',
            value: 'sonnet',
            claim: 'serving',
            source: 'hook',
            scope: { rootKey: ROOT, turnId: null },
            observedAt: at(1),
          },
        });
        yield* world.post(2, { occasion: 'self-description', rootKey: 'foreign-root' });
        const entry = yield* world.wire();
        expect(entry.harness?.model).toBe('sonnet');
        expect(entry.harness?.observation.metadata.model).toMatchObject({ _tag: 'Value', value: 'sonnet' });
        expect(entry.harness?.observation.diagnostics.at(-1)).toMatchObject({ cause: 'foreign-root' });
        const row = (yield* world.summary()) as ReturnType<typeof asThreadListProjection>;
        const facts = wireThreadFacts({ ...row, phase: null, held: { paths: 0, unproven: 0 } });
        const line = threadFactsLine(facts);
        expect(line).toContain('sonnet');
        expect(line).toContain('hook');
        expect(line).toContain('foreign-root');
        const evidence = {
          shape: { thread: { ...row, systemPrompt: null }, entries: 0, runs: [] },
          facet: { title: row.title, projectId: row.projectId, scope: null, harness: row.harness },
          acts: { name: null, entries: 0, blocks: [], bounded: false },
        };
        const shape = wireThreadShape(evidence as Parameters<typeof wireThreadShape>[0], basis);
        expect(shape.thread.harness?.observation.metadata.model).toMatchObject({ _tag: 'Value', value: 'sonnet' });
        const text = threadShapeText(shape);
        expect(text).toContain('sonnet');
        expect(text).toContain('hook');
        expect(text).toContain('foreign-root');
      }),
    );

    it.effect(
      'an observation refresh moves no reader order',
      Effect.fnUntraced(function* () {
        const { raise } = yield* World;
        const world = yield* raise();
        yield* world.post(0);
        const before = yield* world.order();
        yield* world.post(1, { occasion: 'turn-start', turnId: 'turn-1' });
        yield* world.post(2, {
          occasion: 'self-description',
          model: {
            _tag: 'Value',
            value: 'opus',
            claim: 'serving',
            source: 'hook',
            scope: { rootKey: ROOT, turnId: null },
            observedAt: at(2),
          },
        });
        expect(yield* world.order()).toEqual(before);
      }),
    );
  },
);
