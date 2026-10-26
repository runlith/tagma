import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { withGraphCall, forProject } from '../../../../invocation/testing/call.js';
import { execute, prepare } from '../../../../invocation/testing/performing.js';
import type { Bound } from '../../../../platform/contract/service/body.js';
import type { Caller } from '../../../../platform/contract/wire/caller.js';
import { WORK_PAIRS } from '../../../../graph/operations/work.js';
import { knownAnswer } from '../../../../platform/contract/wire/operation.js';
import { WORK_OPERATIONS } from '../../../../graph/contract/wire/operations/work.js';
import type { LawEnforcement } from '../../../../graph/contract/wire/enforcement.js';

const ended = Schema.decodeUnknownEffect(knownAnswer(WORK_OPERATIONS.finish_block.answer));

layer(demoGraphLayer(), { excludeTestServices: true })('ending debt ownership', (it) => {
  it.effect('ending or replacing a debt owner reports each rule without changing its debt', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const caller: Caller = { actor: { kind: 'operator' }, files: null };
        const here = Effect.succeed({
          project: { id: projectId, name: 'demo' },
          vocabulary: yield* demo.table(),
          lens: { scope: undefined, names: 'law-and-reflections' as const },
          deliveredTags: new Set<string>(),
        });
        const call = <Input, Prepared, Answer, R, E>(bound: Bound<Input, Prepared, Answer, R, E>, input: NoInfer<Input>) =>
          Effect.flatMap(prepare(bound, input, caller), (prepared) => execute(bound, input, prepared, caller)).pipe(
            withGraphCall(here),
            forProject(here),
          );
        const other = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Other debt owner' });
        const successor = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Successor' });
        const first = yield* graph.blocks.create({ projectId, tags: ['rule'], title: 'First norm' });
        const second = yield* graph.blocks.create({ projectId, tags: ['rule'], title: 'Second norm' });
        const rules = [first, second];
        const names = yield* Effect.forEach(rules, (rule) => demo.nameOf(rule.id));
        const operations = ['finish_block', 'close_block', 'supersede_block'] as const;
        const owners = yield* Effect.forEach(operations, (operation) =>
          graph.blocks.create({
            projectId,
            tags: [operation === 'close_block' ? 'spec' : 'task'],
            title: operation,
          }),
        );
        const ownerNames = yield* Effect.forEach(owners, (owner) => demo.nameOf(owner.id));
        const documents: LawEnforcement[] = [];
        for (const [index, rule] of rules.entries()) {
          const document: LawEnforcement = {
            strictness: 'gate',
            on: [],
            inspection: 'size',
            escaped: [],
            debt: [
              ...ownerNames.flatMap((owner) =>
                Array.from({ length: index + 1 }, (_, at) => ({ fingerprint: `${owner}-${at}`, owner, count: 9 })),
              ),
              { fingerprint: 'other', owner: yield* demo.nameOf(other.id) },
            ],
          };
          documents.push(document);
          yield* graph.blocks.setEnforcement({ id: rule.id, anchors: [], stood: undefined, document, journal: {} });
        }
        for (const [index, operation] of operations.entries()) {
          const owner = owners[index]!;
          const name = ownerNames[index]!;
          const raw = yield* operation === 'supersede_block'
            ? call(
                { ...WORK_PAIRS.supersede_block.body, id: WORK_PAIRS.supersede_block.id },
                { oldId: name, withId: yield* demo.nameOf(successor.id) },
              )
            : operation === 'finish_block'
              ? call({ ...WORK_PAIRS.finish_block.body, id: WORK_PAIRS.finish_block.id }, { blockId: name })
              : call({ ...WORK_PAIRS.close_block.body, id: WORK_PAIRS.close_block.id }, { blockId: name });
          const answer = yield* ended(raw);
          expect(answer.block.name).toBe(name);
          expect(answer.debt?.map(({ rule, entries }) => ({ rule, entries }))).toEqual([
            { rule: names[0]!, entries: 1 },
            { rule: names[1]!, entries: 2 },
          ]);
          const row = yield* graph.blocks.blockById(owner.id);
          expect(operation === 'supersede_block' ? yield* graph.standing.isSuperseded(row.id) : (yield* demo.table()).isTerminal(row)).toBe(
            true,
          );
          for (const [index, rule] of rules.entries()) {
            expect((yield* graph.blocks.blockById(rule.id)).fields.enforcement).toEqual(documents[index]);
          }
        }
      }),
    ),
  );
});
