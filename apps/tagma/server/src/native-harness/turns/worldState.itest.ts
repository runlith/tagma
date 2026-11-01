import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { threadStack } from '../../composition/testing/threadParts.js';
import { demoGraphLayer, withDemo, type EffectDemo } from '../../composition/testing/graphFixture.js';
import { nativeTurnContext } from './message.js';
import { worldStateSections } from './worldState.js';
import type { WorkspaceInputSet } from '../contract/service/inputs.js';
import type { Message } from '@runlith/llm/schema/messages';
import { CORE_KINDS } from '../testing/doubles.js';

const scratchPath = '/tmp/tagma-scratch/thread-under-test';

const setup = Effect.fnUntraced(function* (demo: EffectDemo) {
  const records = yield* makeThreadRecords;
  const { store, threads } = yield* threadStack({ db: demo.graph.store.db, units: demo.graph.units, records, kinds: CORE_KINDS });
  const threadId = yield* demo.graph.units.write('worldState', (tx) =>
    Effect.gen(function* () {
      const thread = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, tx);
      yield* threads.rows.attachFacet({ threadId: thread.id, projectId: demo.projectId }, tx);
      return thread.id;
    }),
  );
  let turn = 0;
  const history: Message[] = [];
  return Effect.fnUntraced(function* (workspace: WorkspaceInputSet) {
    turn += 1;
    const context = yield* nativeTurnContext({
      threads: threads.rows,
      graph: demo.context,
      threadId,
      runId: `run-${turn}`,
      history,
      digest: true,
      session: { harness: 'tagma', key: threadId },
      written: Effect.succeed([]),
      sections: worldStateSections({
        skills: [
          { id: 'artifacts', description: 'Writes a page this server hosts.' },
          ...workspace.skills.map((entry) => ({ id: entry.id, description: entry.description })),
        ],
        contextFiles: workspace.contextFiles,
        scratch: scratchPath,
      }),
    });
    const commit = context?.commit;
    if (commit !== undefined) yield* demo.graph.units.write('worldState.nextTurn', commit);
    if (context === null) return null;
    history.push(context.message);
    return context.message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
  });
});

function sources(over: Partial<WorkspaceInputSet> = {}): WorkspaceInputSet {
  return { contextFiles: [], shipped: [], skills: [], members: [], disabledSkills: new Set(), inventory: [], rejected: [], ...over };
}

function skill(id: string, description: string, body = 'Do the thing.') {
  return { id, description, instructions: () => body };
}

layer(demoGraphLayer(), { excludeTestServices: true })('workspace turn deltas', (it) => {
  it.effect('the skill catalog arrives on the turn', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const nextTurn = yield* setup(demo);
        const first = yield* nextTurn(sources({ skills: [skill('reviewer', 'Reviews a change.')] }));
        expect(first).toContain('- reviewer: Reviews a change.');
      }),
    ),
  );

  it.effect('an unchanged catalog is never restated', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const nextTurn = yield* setup(demo);
        const workspace = sources({ skills: [skill('reviewer', 'Reviews a change.')] });
        yield* nextTurn(workspace);
        expect(yield* nextTurn(workspace)).toBeNull();
      }),
    ),
  );

  it.effect('a new skill reaches the turn with the list that carries it', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const nextTurn = yield* setup(demo);
        yield* nextTurn(sources({ skills: [skill('reviewer', 'Reviews a change.')] }));
        const changed = yield* nextTurn(
          sources({ skills: [skill('reviewer', 'Reviews a change.'), skill('deployer', 'Ships a release.')] }),
        );
        expect(changed).toContain('- deployer: Ships a release.');
      }),
    ),
  );

  it.effect('editing a skill body alone does not disturb the catalog', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const nextTurn = yield* setup(demo);
        yield* nextTurn(sources({ skills: [skill('reviewer', 'Reviews a change.', 'first body')] }));
        expect(yield* nextTurn(sources({ skills: [skill('reviewer', 'Reviews a change.', 'rewritten body')] }))).toBeNull();
      }),
    ),
  );

  it.effect("a project's instruction files arrive on the turn, and are not repeated", () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const nextTurn = yield* setup(demo);
        const workspace = sources({
          contextFiles: [{ path: '/repo/AGENTS.md', directory: '/repo', name: 'AGENTS.md', body: 'the project law' }],
        });
        expect(yield* nextTurn(workspace)).toContain('the project law');
        expect(yield* nextTurn(workspace)).toBeNull();
      }),
    ),
  );

  it.effect('an edited instruction file reaches the turn with its new body', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const nextTurn = yield* setup(demo);
        yield* nextTurn(sources({ contextFiles: [{ path: '/repo/AGENTS.md', directory: '/repo', name: 'AGENTS.md', body: 'old law' }] }));
        const changed = yield* nextTurn(
          sources({ contextFiles: [{ path: '/repo/AGENTS.md', directory: '/repo', name: 'AGENTS.md', body: 'new law' }] }),
        );
        expect(changed).toContain('new law');
      }),
    ),
  );
});
