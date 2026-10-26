import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { agentRuntimeGuidanceMessage } from '@runlith/agent/AgentSignal';
import { Message } from '@runlith/llm/schema/messages';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import type { InstructionSet } from '../../graph/contract/wire/instructions.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { instructionSnapshot, instructionsTold, instructionTags } from './instructions.js';
import { CORE_KINDS, threadStore } from '../testing/doubles.js';

const machine = Layer.orDie(
  unitsLayer(MachineUnits, MachineStore).pipe(Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
);

const set: InstructionSet = {
  projectId: 7,
  root: '/tmp/reopened',
  audience: 'graph',
  complete: true,
  entries: [
    { kind: 'catalog', source: 'software-development', scope: 'project:7', revision: 'c1', text: 'The catalog.' },
    { kind: 'tag', source: '#claim', scope: 'project:7', revision: 't1', text: '#claim — is claim' },
    { kind: 'law', source: 'abcd1234', scope: 'project:7', revision: 'l1', text: '- abcd1234 Keep the data' },
  ],
};

it.live('the delivered snapshot survives the store: a thread reopened reads its receipts from its own history', () =>
  Effect.gen(function* () {
    const threads = yield* threadStore(yield* makeThreadRecords, CORE_KINDS);
    const guided = agentRuntimeGuidanceMessage('Project instructions', { [instructionsTold(7)]: set });
    const thread = yield* threads.insert({
      ownerId: 'owner',
      agentId: 'tagma',
      history: [Message.user('Hi.'), guided, Message.user('Go on.')],
    });

    const history = (yield* threads.historyOf(thread.id)) ?? [];
    expect(instructionSnapshot(history, 7)).toEqual(set);
    expect(instructionSnapshot(history, 8)).toBeUndefined();
    expect(instructionTags(history, 7)).toEqual(new Set(['7:claim@t1']));

    const compacted = new Message({
      role: 'user',
      content: [{ type: 'text', text: 'Summary.' }],
      compaction: { id: 'context-reset', mode: 'manual', transcriptLocation: '/tmp/reopened', preservedCount: 0 },
    });
    const reset = yield* threads.insert({ ownerId: 'owner', agentId: 'tagma', history: [...history, compacted] });
    expect(instructionSnapshot((yield* threads.historyOf(reset.id)) ?? [], 7)).toBeUndefined();
  }).pipe(Effect.provide(machine)),
);
