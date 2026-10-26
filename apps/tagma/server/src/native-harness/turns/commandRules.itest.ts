import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import type { InputOf } from '../../platform/contract/service/body.js';
import { COMMAND_RULE_PAIRS } from '../../executions/operations/commandRules.js';
import { ruleHead } from '../../executions/contract/wire/commandRules.js';
import { TagIndex } from '../../graph/vocabulary/tagIndex.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { commandRulesSection } from './commandRules.js';
import { nativeTurnContext } from './message.js';
import { threadStack } from '../../composition/testing/threadParts.js';
import type { COMMAND_RULE_OPERATIONS } from '../../executions/contract/wire/operations/commandRules.js';
import { forProject } from '../../invocation/testing/call.js';
import { GRAPH_BEHAVIOURS } from '../../graph/testing/behaviours.js';
import type { Message } from '@runlith/llm/schema/messages';
import { CORE_KINDS } from '../testing/doubles.js';

layer(demoGraphLayer(), { excludeTestServices: true })('command rules on a turn', (it) => {
  it.effect("a thread's turn carries its rules in the order the read answers them, at the start and after every change", () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const records = yield* makeThreadRecords;
        const { store, threads } = yield* threadStack({ db: demo.graph.store.db, units: demo.graph.units, records, kinds: CORE_KINDS });
        const threadId = yield* demo.graph.units.write('commandRulesSection', (tx) =>
          Effect.gen(function* () {
            const row = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, tx);
            yield* threads.rows.attachFacet({ threadId: row.id, projectId: demo.projectId }, tx);
            return row.id;
          }),
        );
        const caller: Caller = {
          actor: {
            kind: 'thread',
            threadId,
            projectId: demo.projectId,
            principalId: 'operator',
            session: { harness: 'tagma', key: threadId },
          },
          files: null,
        };
        const performed = forProject(
          Effect.succeed({
            project: { id: demo.projectId, name: 'demo' },
            vocabulary: new TagIndex([], GRAPH_BEHAVIOURS),
            lens: { scope: undefined, names: 'law-and-reflections' as const },
            deliveredTags: new Set<string>(),
          }),
        );
        const write = (input: InputOf<typeof COMMAND_RULE_OPERATIONS.write_command_rule>) => {
          const body = COMMAND_RULE_PAIRS.write_command_rule.body;
          return Effect.flatMap(body.prepare!(input, caller), (list) => body.execute(input, list, caller)).pipe(performed);
        };
        const read = () => COMMAND_RULE_PAIRS.read_command_rules.body.execute({}, undefined, caller).pipe(performed);
        let turn = 0;
        const history: Message[] = [];
        const nextTurn = Effect.fnUntraced(function* () {
          turn += 1;
          const context = yield* nativeTurnContext({
            threads: threads.rows,
            graph: demo.context,
            threadId,
            runId: `run-${turn}`,
            history,
            digest: false,
            session: { harness: 'tagma', key: threadId },
            written: Effect.succeed([]),
            sections: [commandRulesSection(demo.graph.store, demo.projectId, threadId)],
          });
          const commit = context?.commit;
          if (commit !== undefined) yield* demo.graph.units.write('commandRulesSection.nextTurn', commit);
          if (context === null) return null;
          history.push(context.message);
          return context.message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
        });
        const told = (text: string | null): readonly string[] =>
          (text ?? '')
            .split('\n')
            .filter((line) => line.startsWith('- '))
            .map((line) => line.slice(2));

        expect(yield* nextTurn()).toBeNull();
        const project = yield* write({ reach: 'project', measure: 'life', limitMs: 1_200_000, words: 'twenty minutes for all' });
        expect(told(yield* nextTurn())).toEqual([ruleHead(project.rule)]);
        expect(yield* nextTurn()).toBeNull();

        const own = yield* write({ reach: 'thread', measure: 'life', limitMs: 300_000, words: 'five for this one' });
        const machine = yield* write({ reach: 'machine', measure: 'life', limitMs: 60_000, words: 'one minute everywhere' });
        const changed = told(yield* nextTurn());
        const listed = (yield* read()).rules;
        expect(changed).toEqual(listed.map(ruleHead));
        expect(listed.map((rule) => rule.id)).toEqual([machine.rule.id, project.rule.id, own.rule.id]);

        for (const rule of listed) {
          const body = COMMAND_RULE_PAIRS.remove_command_rule.body;
          yield* Effect.flatMap(body.prepare!({ id: rule.id }, caller), (prepared) => body.execute({ id: rule.id }, prepared, caller)).pipe(
            performed,
          );
        }
        const emptied = yield* nextTurn();
        expect(emptied).not.toBeNull();
        expect(told(emptied)).toEqual([]);
      }),
    ),
  );
});
