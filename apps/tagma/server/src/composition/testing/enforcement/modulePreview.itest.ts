import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { ToolAnswer, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { toolDecode } from '@runlith/agent/tool/arguments';
import { Context, Effect } from 'effect';
import { RoutedGraphs } from '../../../graph/contract/service/serving.js';
import { OperationSubjects } from '../../../enforcement/contract/service/operationSubjects.js';
import { LAYERED_KEY } from '../../../enforcement/testing/layered.js';
import { checkSubjectOf } from '../../catalog.js';
import { quiet } from '../../../enforcement/testing/wiring.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { fixedCheckoutPaths } from '../../../workspace/testing/doubles.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { unthreadedCaller } from '../callers.js';
import { fixtureNativeCatalog, fixtureServedGraphs } from '../nativeCatalog.js';
import { Enforcements, enforceFixture, withEnforcement } from './enforceFixture.js';

layer(enforceFixture(), { excludeTestServices: true })('module map preview', (it) => {
  it.effect('a native preview reports a new private import without writing the map or enforcement, and the write reports its escape', () =>
    withEnforcement((fx) =>
      Effect.gen(function* () {
        const rule = yield* fx.created(['rule'], 'Import through module entries');
        const owner = yield* fx.created(['task'], 'Move the view off the panel');
        yield* fx.enforce({ blockId: rule, strictness: 'gate', inspection: LAYERED_KEY, owner });
        const before = yield* fx.documentOf(rule);
        const cards = yield* fx.demo.graph.blocks.moduleCards(fx.demo.projectId);
        const { workers } = yield* Enforcements;
        const context = Context.merge(fx.demo.context, quiet(workers));
        const graphs = fixtureServedGraphs(context);
        const vocabulary = yield* fx.demo.table();
        const root = fx.demo.demoRoot;
        yield* bornThread(
          fx.demo.graph.store.db,
          {
            id: 'map-author',
            ownerId: 'tagma',
            agentId: 'tagma',
            model: 'gpt-test',
            reasoning: 'high',
            status: 'idle',
            spawnRootId: 'map-author',
            authority: { mode: 'trust', bypassFrom: null },
          },
          { projectId: fx.demo.projectId, readerOrderAt: new Date(0) },
        );
        const tools = yield* fixtureNativeCatalog(
          {
            caller: {
              actor: {
                kind: 'thread',
                threadId: 'map-author',
                projectId: fx.demo.projectId,
                principalId: 'tagma',
                session: { harness: 'tagma', key: 'map-author' },
              },
              files: null,
            },
            place: { root, origin: null },
            world: 'checkout',
            served: yield* graphs.resolve({ projectId: fx.demo.projectId, cwd: root }),
            project: { id: fx.demo.projectId, name: 'demo' },
            vocabulary: () => vocabulary,
            identity: testSessionIdentity,
            owners: context.pipe(
              Context.add(OperationSubjects, { of: checkSubjectOf }),
              Context.add(RoutedGraphs, graphs),
              Context.add(CheckoutPaths, yield* fixedCheckoutPaths(fx.demo.projectId, [{ checkout: 'main', root }])),
            ),
          },
          ['set_module'],
        );
        const tool = tools.set_module!;
        let sequence = 0;
        const call = Effect.fnUntraced(function* (input: unknown) {
          const decoded = yield* toolDecode(tool, input);
          const invoked = { caller: unthreadedCaller, toolCallId: `map-${++sequence}`, messages: [] };
          const prepared = yield* toolPrepare(tool)!(decoded, invoked);
          const answer = yield* toolExecute(tool)!(decoded, { ...invoked, prepared: prepared.prepared });
          if (!(answer instanceof ToolAnswer)) return yield* Effect.die('set_module returned no tool answer');
          return answer;
        });
        const parent = yield* fx.demo.nameOf(fx.demo.root);
        const modules = [{ id: 'consumer', title: 'Consumer', parent, root: 'src/app', imports: { put: ['app'] } }];
        const fingerprint = 'consumer -> app private @ app/main.ts';
        const preview = yield* call({ modules, preview: true });
        expect(preview.value).toMatchObject({ status: 'preview', rules: [{ rule, escaped: [fingerprint] }] });
        expect(preview.text).toContain(fingerprint);
        expect(yield* fx.demo.graph.blocks.moduleCards(fx.demo.projectId)).toEqual(cards);
        expect(yield* fx.documentOf(rule)).toEqual(before);
        const written = yield* call({ modules });
        expect(written.value).toMatchObject({ status: 'ok', rules: [{ rule, escaped: [fingerprint] }] });
        expect(written.text).toContain(fingerprint);
        expect((yield* fx.demo.graph.blocks.moduleCards(fx.demo.projectId)).map((card) => card.id)).toContain('consumer');
        expect((yield* fx.documentOf(rule))?.escaped).toMatchObject([{ fingerprint }]);
      }),
    ),
  );
});
