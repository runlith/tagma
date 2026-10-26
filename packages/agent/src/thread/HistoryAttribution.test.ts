import { describe, expect, test } from 'bun:test';
import { Message, ToolCallPart, ToolResultPart } from '@runlith/llm/schema/messages';
import { withAgentOrigin, withAgentReaderInput } from '../agent/AgentSignal';
import type { ThreadEventBody } from './events';
import { HistoryAttribution } from './HistoryAttribution';
import { HistoryFold } from './HistoryFold';

type Log = { readonly attribution: HistoryAttribution; readonly fold: HistoryFold; readonly events: ThreadEventBody[]; position: number };

function log(): Log {
  return { attribution: new HistoryAttribution(), fold: new HistoryFold(), events: [], position: 0 };
}

function write(into: Log, ...events: readonly ThreadEventBody[]): void {
  for (const event of events) {
    into.position += 1;
    into.events.push(event);
    into.attribution.fold(into.position, event);
    into.fold.fold(event, into.position);
  }
}

function turn(runId: string, words: string, answer: readonly Message[]): readonly ThreadEventBody[] {
  return [
    {
      kind: 'message',
      payload: {
        entry: { type: 'message', id: `message:user:${runId}`, role: 'user', runId, text: words },
        messages: [Message.user(words)],
      },
    },
    {
      kind: 'step',
      payload: {
        messages: answer,
        context: { runId, stepNumber: 0, provider: null, model: null, contextWindow: null, measuredAt: '2026-09-30T00:00:00.000Z' },
      },
    },
    { kind: 'run-end', payload: { entry: runEnd(`run-end:${runId}`, runId) } },
  ];
}

function tasked(runId: string, words: string, answer: readonly Message[]): readonly ThreadEventBody[] {
  const [, ...rest] = turn(runId, words, answer);
  const entry = {
    type: 'signal',
    id: `signal:${runId}`,
    runId,
    signalType: 'task',
    addressee: 'transport',
    text: words,
    title: 'lead',
  } as const;
  return [{ kind: 'signal', payload: { entry, messages: [Message.user(words)] } }, ...rest];
}

function pinned(words: string): ThreadEventBody {
  return {
    kind: 'signal',
    payload: {
      entry: { type: 'signal', id: `signal:${words}`, signalType: 'user-message', addressee: 'reader', text: words },
      messages: [Message.user(words)],
    },
  };
}

function runEnd(id: string, runId: string) {
  const at = '2026-09-30T00:00:00.000Z';
  return { type: 'run-end', id, runId, status: 'completed', startedAt: at, finishedAt: at, occurredAt: at } as const;
}

function texts(messages: readonly Message[]): readonly string[] {
  return messages.map((message) => message.content.map((part) => (part.type === 'text' ? part.text : part.type)).join(''));
}

function rewind(into: Log, id: string, runId: string, scope: 'from' | 'turn'): readonly string[] {
  const plan = into.attribution.plan(runId, scope);
  if ('blocked' in plan) throw new Error(plan.blocked);
  write(into, { kind: 'rewind', payload: { rewound: { id, scope, runIds: plan.runIds, cuts: plan.cuts } } });
  return plan.runIds;
}

function restore(into: Log, rewindId: string): void {
  const plan = into.attribution.restorePlan(rewindId);
  if ('refused' in plan) throw new Error(plan.refused);
  const inserts = plan.inserts.map((insert) => ({
    at: insert.at,
    messages: insert.messages.map((source) => {
      const payload = into.events[source.position - 1]!.payload;
      return source.insert === undefined
        ? (payload.compacted?.messages ?? payload.messages)![source.index]!
        : payload.restored!.inserts[source.insert]!.messages[source.index]!;
    }),
  }));
  write(into, { kind: 'restore', payload: { restored: { rewindId, runIds: plan.runIds, inserts } } });
}

const probe = [
  Message.assistant([ToolCallPart.from({ id: 'call-b', name: 'probe', input: {} })]),
  Message.tool(ToolResultPart.from({ id: 'call-b', name: 'probe', result: 'ok' })),
  Message.assistant('probed'),
];

describe('HistoryAttribution', () => {
  test('a turn another agent’s task opened is a rewind point like the operator’s own', () => {
    const thread = log();
    write(thread, ...turn('run-a', 'one', [Message.assistant('one')]));
    write(thread, ...tasked('run-b', 'rebuild the index', [Message.assistant('rebuilt')]));
    expect(thread.attribution.points().points).toEqual([
      { runId: 'run-a', rewindable: true },
      { runId: 'run-b', rewindable: true },
    ]);
  });

  test('retained attribution is bounded by message descriptors, and an advanced copy leaves its prior snapshot intact', () => {
    const thread = log();
    write(thread, ...turn('run-a', 'one', [Message.assistant('x'.repeat(64 * 1024))]));
    const before = thread.attribution.points();
    const advanced = thread.attribution.copy();
    for (const event of turn('run-b', 'two', [Message.assistant('two')])) advanced.fold(++thread.position, event);
    expect(advanced.points().points).toHaveLength(2);
    expect(thread.attribution.points()).toEqual(before);
    expect(thread.attribution.retainedBytes).toBeLessThan(2048);
    expect(thread.attribution.rewriteTokens([{ from: 0, to: 1 }])).toBeGreaterThan(16000);
  });

  test('a dropped turn takes exactly its run’s messages — its tool pair whole — and leaves words pinned inside it', () => {
    const thread = log();
    write(thread, ...turn('run-a', 'one', [Message.assistant('did one')]));
    const [opening, step, ending] = turn('run-b', 'two', probe);
    write(thread, opening!, pinned('pinned mid-run'), step!, ending!);
    write(thread, ...turn('run-c', 'three', [Message.assistant('did three')]));

    expect(rewind(thread, 'drop-b', 'run-b', 'turn')).toEqual(['run-b']);

    expect(texts(thread.fold.take())).toEqual(['one', 'did one', 'pinned mid-run', 'three', 'did three']);
    expect(thread.attribution.size).toBe(thread.fold.take().length);
  });

  test('restores put every rewound message back where it stood, in whichever order they are asked', () => {
    const thread = log();
    write(thread, ...turn('run-a', 'one', [Message.assistant('did one')]));
    write(thread, ...turn('run-b', 'two', probe));
    write(thread, pinned('pinned between'));
    write(thread, ...turn('run-c', 'three', [Message.assistant('did three')]));
    write(thread, ...turn('run-d', 'four', [Message.assistant('did four')]));
    const before = thread.fold.take();

    rewind(thread, 'drop-b', 'run-b', 'turn');
    expect(rewind(thread, 'from-c', 'run-c', 'from')).toEqual(['run-c', 'run-d']);
    expect(texts(thread.fold.take())).toEqual(['one', 'did one', 'pinned between']);

    restore(thread, 'drop-b');
    restore(thread, 'from-c');

    expect(thread.fold.take()).toEqual(before);
    expect(thread.attribution.points().rewinds).toEqual([]);
  });

  test('a turn another run followed is no longer restorable, and a rewind takes out only runs no other rewind holds', () => {
    const thread = log();
    write(thread, ...turn('run-a', 'one', [Message.assistant('did one')]));
    write(thread, ...turn('run-b', 'two', [Message.assistant('did two')]));
    write(thread, ...turn('run-c', 'three', [Message.assistant('did three')]));
    rewind(thread, 'drop-c', 'run-c', 'turn');

    expect(rewind(thread, 'from-b', 'run-b', 'from')).toEqual(['run-b']);
    write(thread, ...turn('run-e', 'five', [Message.assistant('did five')]));

    expect(thread.attribution.restorePlan('from-b')).toEqual({ refused: 'restore-superseded' });
    expect(thread.attribution.points().points).toEqual([
      { runId: 'run-a', rewindable: true },
      { runId: 'run-b', rewindable: false, reason: 'rewind-rewound' },
      { runId: 'run-c', rewindable: false, reason: 'rewind-rewound' },
      { runId: 'run-e', rewindable: true },
    ]);
  });

  test('a compaction summarizes the runs it covered out of reach and keeps attributing the tail it retained, pruned copies included', () => {
    const thread = log();
    write(thread, ...turn('run-a', 'one', [Message.assistant('did one')]));
    const [opening, ...answer] = turn('run-b', 'two', probe);
    write(
      thread,
      { ...opening!, payload: { ...opening!.payload, messages: [withAgentReaderInput(Message.user('two'), 'message:user:run-b')] } },
      ...answer,
    );
    const head = [withAgentOrigin(Message.user('summary follows'), 'summary'), withAgentOrigin(Message.assistant('summary'), 'summary')];
    const tail = thread.fold.take().slice(2);
    write(thread, { kind: 'compaction', payload: { compacted: { keepFrom: 6, messages: [...head, ...tail] } } });
    write(thread, { kind: 'pruning', payload: { compacted: { keepFrom: 6, messages: thread.fold.take() } } });

    expect(thread.attribution.plan('run-a', 'from')).toEqual({ blocked: 'rewind-summarized' });
    expect(rewind(thread, 'drop-b', 'run-b', 'turn')).toEqual(['run-b']);
    expect(texts(thread.fold.take())).toEqual(['summary follows', 'summary']);
  });

  test('a compaction that pins an earlier opening attributes the pin to its own run, and the run it cut through is summarized', () => {
    const thread = log();
    write(thread, ...turn('run-a', 'one', [Message.assistant('did one')]));
    write(thread, ...turn('run-b', 'two', [Message.assistant('did two')]));
    const woken = (text: string, stepNumber: number): ThreadEventBody => ({
      kind: 'step',
      payload: {
        messages: [Message.assistant(text)],
        context: { runId: 'run-w', stepNumber, provider: null, model: null, contextWindow: null, measuredAt: '2026-09-30T00:00:00.000Z' },
      },
    });
    write(thread, woken('woke up', 0), woken('still going', 1));
    const opening = thread.fold.take()[2]!;
    const head = [withAgentOrigin(Message.user('summary follows'), 'summary'), withAgentOrigin(Message.assistant('summary'), 'summary')];
    write(thread, { kind: 'compaction', payload: { compacted: { keepFrom: 5, messages: [...head, opening] } } });
    write(thread, { kind: 'run-end', payload: { entry: runEnd('run-end:run-w', 'run-w') } });
    write(thread, ...turn('run-x', 'three', [Message.assistant('did three')]));

    expect(thread.attribution.plan('run-w', 'turn')).toEqual({ blocked: 'rewind-summarized' });
    const before = thread.fold.take();
    rewind(thread, 'from-x', 'run-x', 'from');
    expect(texts(thread.fold.take())).toEqual(['summary follows', 'summary', 'two', 'still going']);
    expect(thread.attribution.size).toBe(thread.fold.take().length);
    restore(thread, 'from-x');
    expect(thread.fold.take()).toEqual(before);
  });
});
