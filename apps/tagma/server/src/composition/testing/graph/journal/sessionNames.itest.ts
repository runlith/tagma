import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { HISTORY_PAIRS } from '../../../../graph/operations/history.js';
import { bornThread } from '../../../../native-harness/testing/born.js';
import { signedBy, withGraphCall } from '../../../../invocation/testing/call.js';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';

layer(demoGraphLayer())('journal session names', (it) => {
  it.effect('read_journal joins a native thread name and title while a foreign writer remains unnamed', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        yield* bornThread(
          graph.store.db,
          {
            ownerId: 'owner',
            agentId: 'tagma',
            provider: 'openai-oauth',
            model: 'gpt-test',
            reasoning: 'high',
            authority: { mode: 'trust', bypassFrom: null },
            status: 'idle',
            createdAt: new Date(0),
            updatedAt: new Date(0),
            id: 'thread-builder',
            spawnRootId: 'thread-builder',
            cacheGroup: 'thread-builder',
            name: 'builder',
          },
          { projectId, title: 'Wire the journal', readerOrderAt: new Date(0) },
        );
        for (const session of [
          { harness: 'tagma', key: 'thread-builder' },
          { harness: 'claude-code', key: 'transcript-1' },
        ]) {
          yield* signedBy(session)(graph.blocks.create({ projectId, tags: ['idea'], title: session.key }));
        }
        const page = yield* HISTORY_PAIRS.read_journal.body
          .execute({ limit: 2 }, undefined, { actor: { kind: 'operator' }, files: null })
          .pipe(
            withGraphCall(
              Effect.succeed({
                project: { id: projectId, name: 'demo' },
                vocabulary: yield* demo.table(),
                lens: { scope: undefined, names: 'law-and-reflections' },
                deliveredTags: new Set<string>(),
              }),
            ),
          );
        const named = (harness: string) => page.sessions.find((row) => row.harness === harness);
        expect(named('tagma')).toMatchObject({ key: 'thread-builder', title: 'Wire the journal', name: 'builder' });
        expect(named('claude-code')).toMatchObject({ key: 'transcript-1', title: null, name: null });
      }),
    ),
  );
});
