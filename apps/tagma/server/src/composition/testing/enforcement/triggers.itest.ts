import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { join } from 'node:path';
import { symlinkSync } from 'node:fs';
import { fixedCheckoutPaths } from '../../../workspace/testing/doubles.js';
import { afterEditCheck } from '../../../enforcement/operationChecks.js';
import { Deferred, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { block } from '../../../graph/store/tables.js';
import { refusalOf } from '../graphFixture.js';
import { MINE } from '../checkoutFixture.js';
import { landingFixture, withLanding, type LandingFixture } from '../landingFixture.js';
import { perform, triggered } from '../../../invocation/testing/performing.js';
import { forProject, withGraphCall } from '../../../invocation/testing/call.js';
import { OUTLINE_PAIRS } from '../../../graph/operations/outline.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import { operationChecks } from '../../operationChecks.js';
import { OperationChecks } from '../../../invocation/contract/service/operationChecks.js';
import { OperationCatalog } from '../../../invocation/contract/service/catalog.js';
import { fixtureOperationCatalog as operationCatalog } from '../nativeCatalog.js';
import { checksOver, driverOver, triggersOver, withLanes } from '../../../enforcement/testing/wiring.js';
import type { EscapeNotice } from '../../../enforcement/contract/wire/checks.js';
const CROSSING = "import { main } from '../app/main';\nexport const boot = main;\n";
const served = (gate: LandingFixture) => withLanes(gate.demo.context, gate.workers);
const agentIn = (gate: LandingFixture): Caller => ({
  actor: {
    kind: 'thread',
    threadId: MINE,
    projectId: gate.demo.projectId,
    principalId: 'tagma',
    session: { harness: 'tagma', key: MINE },
  },
  files: null,
});
const READ_VOCABULARY = { ...OUTLINE_PAIRS.read_vocabulary.body, id: 'read_vocabulary' };
const projectCall = (gate: LandingFixture) =>
  Effect.orDie(gate.demo.table()).pipe(
    Effect.map((vocabulary) => ({
      project: { id: gate.demo.projectId, name: 'demo' },
      vocabulary,
      lens: { scope: undefined, names: 'law-and-reflections' as const },
      deliveredTags: new Set<string>(),
    })),
  );
const operationGate = Effect.fnUntraced(function* (gate: LandingFixture) {
  const graphOf = () => Effect.succeed(served(gate));
  const triggers = triggersOver(graphOf);
  const checks = checksOver({ graphOf, triggers });
  const catalog = yield* operationCatalog;
  const gated = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provideService(OperationChecks, operationChecks(checks)), Effect.provideService(OperationCatalog, catalog));
  const ask = (op: string, caller: Caller = agentIn(gate)) => gated(triggered(op, caller, Effect.succeed(op)));
  const readVocabulary = gated(perform(READ_VOCABULARY, {}, agentIn(gate))).pipe(
    forProject(projectCall(gate)),
    withGraphCall(projectCall(gate)),
  );
  return { ask, readVocabulary, triggers };
});
layer(landingFixture(), { excludeTestServices: true })('landing enforcement', (it) => {
  it.effect('a rule triggered after edit tells the editing thread the crossing its edit wrote, and records nothing', () =>
    withLanding((gate) =>
      Effect.fnUntraced(function* () {
        yield* gate.enforcedAt('gate', undefined, [{ op: 'edit', phase: 'after' }]);
        const told = yield* Deferred.make<readonly EscapeNotice[]>();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const graphOf = () => Effect.succeed(served(gate));
            const triggers = triggersOver(graphOf);
            const driver = yield* driverOver({ graphOf, forget: triggers.forget, delayMs: 0 });
            driver.telling((notice) => Effect.as(Deferred.succeed(told, [notice]), { _tag: 'Accepted' as const }));
            const checks = checksOver({ graphOf, triggers, driver });
            yield* gate.wrote(MINE, 'src/core/boot.ts', CROSSING);
            const caller = { _tag: 'Thread' as const, threadId: ThreadId.make(MINE), projectId: gate.demo.projectId };
            yield* checks.after('write', {
              kind: 'file',
              projectId: gate.demo.projectId,
              root: gate.demo.demoRoot,
              paths: ['src/core/boot.ts'],
              caller,
            });
            const home = yield* gate.demo.fixture.directory('symlink-home');
            const project = yield* gate.demo.graph.projectLifecycle.create({ name: 'symlink-home', rootPath: home });
            const link = join(home, 'linked');
            symlinkSync(join(gate.demo.demoRoot, 'src/core/boot.ts'), link);
            const paths = yield* fixedCheckoutPaths(gate.demo.projectId, [{ checkout: 'target', root: gate.demo.demoRoot }]);
            yield* afterEditCheck(
              checks,
              { edit: 'file' },
              {
                workingRoot: home,
                projectId: project.id,
                thread: { id: MINE },
              },
              { name: 'edit', shown: [{ path: link, as: 'wrote' }] },
              paths.resourceAcross,
            );
            const notices = yield* Deferred.await(told);
            expect(notices.map((one) => one.threadId)).toEqual([MINE]);
            expect(notices[0]?.text).toMatch(
              /\|Import only downward\]\] · gate\n {4}fix: .+\n {4}src\/core\/boot\.ts:1 imports `\.\.\/app\/main`/u,
            );
          }),
        );
        expect(gate.landed(yield* gate.submit(MINE)).watched).toBeUndefined();
      })(),
    ),
  );
  it.effect(
    'the same rule triggered before submit_work at gate refuses the landing, and with no trigger runs only through check_rules',
    () =>
      withLanding((gate) =>
        Effect.fnUntraced(function* () {
          yield* gate.wrote(MINE, 'src/core/boot.ts', CROSSING);
          yield* gate.enforcedAt('gate', undefined, [{ op: 'submit_work', phase: 'before' }]);
          expect((yield* gate.refused(MINE)).code).toBe('rule-violated');
          yield* gate.enforcedAt('gate', undefined, []);
          expect((yield* gate.checked(MINE))?.violations.map((one) => one.fingerprint)).toEqual(['app order core/boot.ts -> app/']);
          const receipt = gate.landed(yield* gate.submit(MINE));
          expect([receipt.watched, receipt.unjudged]).toEqual([undefined, undefined]);
        })(),
      ),
  );
  it.effect(
    'an operation that changes nothing, triggered before at gate, refuses an agent while HEAD holds a violation outside the debt, and never judges the operator',
    () =>
      withLanding((gate) =>
        Effect.fnUntraced(function* () {
          const operator: Caller = { actor: { kind: 'operator' }, files: null };
          const { ask, triggers } = yield* operationGate(gate);
          yield* gate.enforcedAt('gate', undefined, [{ op: 'read_block', phase: 'before' }]);
          expect(yield* ask('read_block')).toBe('read_block');
          yield* gate.put('src/core/boot.ts', CROSSING);
          yield* gate.committed('a crossing that got in outside Tagma');
          triggers.forget(gate.demo.projectId);
          expect((yield* refusalOf(ask('read_block'))).code).toBe('rule-violated');
          expect(yield* ask('read_block', operator)).toBe('read_block');
        })(),
      ),
  );
  it.effect(
    'a stored declaration that does not read refuses the landing, read_vocabulary still names it to an agent, and deleting it with its nodes standing lets the landing through',
    () =>
      withLanding((gate) =>
        Effect.fnUntraced(function* () {
          const { graph, projectId } = gate.demo;
          const declared = yield* graph.blocks.create({
            projectId,
            parentId: gate.demo.root,
            tags: ['tag'],
            title: '#proposal',
            fields: { id: 'proposal', fields: { ops: 'string' }, roles: { leaf: true } },
          });
          yield* gate.created(['proposal'], 'An amendment');
          yield* graph.graphStore.db
            .update(block)
            .set({ fields: { ...declared.fields, roles: { leaf: true, amendment: 'ops' } } })
            .where(eq(block.id, declared.id));
          yield* graph.tags.forget(projectId);
          yield* gate.wrote(MINE, 'README.md', 'outside the rule’s reach\n');
          expect((yield* gate.refused(MINE)).code).toBe('inspection-failed');
          const { ask, readVocabulary } = yield* operationGate(gate);
          expect((yield* refusalOf(ask('search_blocks'))).code).toBe('inspection-failed');
          expect(yield* ask('read_tags')).toBe('read_tags');
          expect((yield* readVocabulary).unreadable.map((one) => one.id)).toEqual(['proposal']);
          yield* graph.trash.delete({ id: declared.id });
          gate.landed(yield* gate.submit(MINE));
        })(),
      ),
  );
});
