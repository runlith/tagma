import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Schema } from 'effect';
import { ToolAnswer, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { unthreadedCaller } from '../callers.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';
import { servingLayer, withServing } from './serving/fixture.js';
import { sessionIdentity } from '../../../external-harnesses/sessionPrefix.js';
import { onGraph, signedBy } from '../../../invocation/testing/call.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { HISTORY_OPERATIONS } from '../../../graph/contract/wire/operations/history.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { Tasks } from '../../../graph/contract/service/work.js';
import { Tags } from '../../../graph/contract/service/vocabulary.js';
import { BlockNames } from '../../../graph/contract/service/acts.js';
import { machineGraphOf } from '../../../graph/testing/doubles.js';
import { routedContext } from '../../../graph/serving/routing.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { fixedCheckoutPaths } from '../../../workspace/testing/doubles.js';

const holderThread = '01990000-0000-7000-8000-000000002742';
const readerThread = '01990000-0000-7000-8000-000000002744';
const listed = Schema.decodeUnknownEffect(knownAnswer(HISTORY_OPERATIONS.list_sessions.answer));

layer(servingLayer, { excludeTestServices: true, timeout: '60 seconds', testTimeout: '60 seconds' })(
  'writer sessions through native tools',
  (it) => {
    it.effect('resolves a block holder in its served copy and walks bounded writers without losing the total', () =>
      withServing(({ demo, served, pool, projectId, repo }) =>
        onGraph(served)(
          Effect.gen(function* () {
            const blocks = yield* Blocks;
            const tasks = yield* Tasks;
            const tags = yield* Tags;
            const names = yield* BlockNames;
            const paths = yield* fixedCheckoutPaths(projectId, [{ checkout: 'repo', root: repo }]);
            const standing = {
              caller: {
                actor: {
                  kind: 'thread',
                  threadId: readerThread,
                  projectId,
                  principalId: 'owner',
                  session: { harness: 'tagma', key: readerThread },
                },
                files: null,
              },
              place: { root: repo, origin: null },
              project: { id: projectId, name: 'repo' },
              vocabulary: yield* tags.reader(projectId),
              identity: sessionIdentity,
              world: 'checkout',
              graphRoot: served.layout.treeRoot,
              owners: Context.add(routedContext(machineGraphOf(demo.context), pool), CheckoutPaths, paths),
              served,
            } as const;
            let calls = 0;
            const call = Effect.fnUntraced(function* (id: string, input: Record<string, unknown>) {
              const tools = yield* fixtureNativeCatalog(standing, [id]);
              const tool = tools[id]!;
              const toolCallId = `writer-sessions-${++calls}`;
              const prepared = yield* toolPrepare(tool)!(input, { toolCallId, caller: unthreadedCaller });
              const answered = yield* toolExecute(tool)!(input, {
                toolCallId,
                caller: unthreadedCaller,
                messages: [],
                prepared: prepared.prepared,
              });
              return answered instanceof ToolAnswer ? answered.value : answered;
            });
            const baseline = yield* Effect.flatMap(call('list_sessions', {}), listed);
            const held = yield* signedBy({ harness: 'tagma', key: holderThread })(
              Effect.gen(function* () {
                const made = yield* blocks.create({ projectId, tags: ['task'], title: 'Held task' });
                return yield* tasks.claim({ id: made.id });
              }),
            );
            yield* signedBy({ harness: 'claude-code', key: 'external-writer' })(
              blocks.create({ projectId, tags: ['idea'], title: 'External write' }),
            );
            const first = yield* Effect.flatMap(call('list_sessions', { limit: 1, checkout: repo }), listed);
            expect(first.sessions).toHaveLength(1);
            expect(first.total).toBe(baseline.total + 2);
            expect(first.next).toBeString();
            expect(first.sessions[0]).toMatchObject({ harness: 'claude-code', thread: null });
            const page = yield* Effect.flatMap(call('list_sessions', { limit: 1, cursor: first.next }), listed);
            expect(page.total).toBe(first.total);
            expect(page.sessions).toMatchObject([{ harness: 'tagma', thread: holderThread }]);
            const name = yield* names.nameOf(held.id);
            const read = yield* call('read_block', { blockIds: [name], depth: 0 });
            const holder = (yield* tags.of(projectId)).holderOf(held)!;
            expect(read).toMatchObject({ reads: [{ fields: { holder } }] });
            expect(yield* call('read_session', { id: holder, checkout: repo })).toMatchObject({
              status: 'ok',
              session: { id: holder, harness: 'tagma', key: holderThread, thread: holderThread },
            });
            expect(yield* call('read_session', { id: 999999 })).toMatchObject({ status: 'refused', code: 'not-found' });
            expect(page.next).toBeNull();
            expect(yield* call('list_sessions', { cursor: 'not-a-cursor' })).toMatchObject({ status: 'refused', code: 'bad-cursor' });
          }),
        ),
      ),
    );
  },
);
