import { describe, expect, test } from 'bun:test';
import {
  applyThreadEntryPlacements,
  foldThreadTranscript,
  heldInList,
  placeThreadEntry,
  type ThreadEntryPlacement,
  type ThreadEventFact,
} from './eventFold';
import { TranscriptFold, foldTranscriptBatch } from './TranscriptFold';
import type { ThreadTranscript } from './rows';

const fold = (transcript: ThreadTranscript, facts: readonly ThreadEventFact[]) => facts.reduce(foldThreadTranscript, transcript);

describe('foldThreadTranscript', () => {
  test('a system prompt takes the head once and retakes it on replay', () => {
    const prompt: ThreadEventFact = {
      kind: 'system-prompt',
      entry: { type: 'system-prompt', id: 'system-prompt:run-1', text: 'You are.' },
    };
    const message: ThreadEventFact = {
      kind: 'message',
      entry: { type: 'message', id: 'user:run-1', role: 'user', text: 'Hi.' },
    };
    const once = fold([], [message, prompt]);
    expect(once.map((entry) => entry.id)).toEqual(['system-prompt:run-1', 'user:run-1']);
    expect(fold(once, [prompt])).toEqual(once);
  });

  test('a failure keeps its index when replayed over entries the server wrote after it', () => {
    const failure: ThreadEventFact = {
      kind: 'failure',
      entry: {
        type: 'failure',
        id: 'failure:run-1',
        runId: 'run-1',
        message: 'Provider died.',
        diagnostics: {
          provider: null,
          account: null,
          stage: 'stream',
          type: 'provider',
          retryable: null,
          modelStarted: null,
          record: { threadId: 'thread-1', runId: 'run-1', entryId: 'failure:run-1' },
        },
      },
    };
    const later: ThreadEventFact = {
      kind: 'message',
      entry: { type: 'message', id: 'user:run-2', role: 'user', text: 'Again.' },
    };
    const server = fold([], [failure, later]);
    expect(server.map((entry) => entry.id)).toEqual(['failure:run-1', 'user:run-2']);
    expect(fold(server, [failure])).toEqual(server);
  });

  test('an entry transitions in place under its id, and replaying the transition is a no-op', () => {
    const call: ThreadEventFact = {
      kind: 'tool',
      entry: { type: 'tool', id: 'tool:call-1', toolCallId: 'call-1', toolState: 'input-available' },
    };
    const result: ThreadEventFact = {
      kind: 'tool',
      entry: { type: 'tool', id: 'tool:call-1', toolCallId: 'call-1', toolState: 'output-available' },
    };
    const settled = fold([], [call, result]);
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ toolState: 'output-available' });
    expect(fold(settled, [result])).toEqual(settled);
  });

  test('a compaction transition keeps the moment it started, replayed or not', () => {
    const running: ThreadEventFact = {
      kind: 'compaction',
      entry: { type: 'compaction', id: 'compaction:run-1', status: 'running', occurredAt: 'T1' },
    };
    const completed: ThreadEventFact = {
      kind: 'compaction',
      entry: { type: 'compaction', id: 'compaction:run-1', status: 'completed', occurredAt: 'T2' },
    };
    const done = fold([], [running, completed]);
    expect(done[0]).toMatchObject({ status: 'completed', occurredAt: 'T1' });
    expect(fold(done, [completed])).toEqual(done);
  });
});

describe('placeThreadEntry', () => {
  const held: ThreadTranscript = [
    { type: 'system-prompt', id: 'prompt', text: 'You are.' },
    { type: 'message', id: 'u-1', role: 'user', text: 'Hi.' },
    { type: 'tool', id: 'call-1', runId: 'run-1', toolName: 'read', toolCallId: 'c', toolState: 'input-available' },
  ];

  test('an unknown id appends, a known one replaces, and a prompt takes the head', () => {
    expect(placeThreadEntry(heldInList(held), { kind: 'message', entry: { type: 'message', id: 'a-1', text: 'Done.' } })).toEqual({
      kind: 'append',
      entry: { type: 'message', id: 'a-1', text: 'Done.' },
    });

    const settled = {
      type: 'tool' as const,
      id: 'call-1',
      runId: 'run-1',
      toolName: 'read',
      toolCallId: 'c',
      toolState: 'output-available' as const,
    };
    expect(placeThreadEntry(heldInList(held), { kind: 'tool', entry: settled })).toEqual({ kind: 'replace', entry: settled });

    const prompt = { type: 'system-prompt' as const, id: 'prompt:run-2', text: 'You still are.' };
    expect(placeThreadEntry(heldInList(held), { kind: 'system-prompt', entry: prompt })).toEqual({ kind: 'prepend', entry: prompt });
  });

  test('a system prompt already held replaces instead of taking the head twice', () => {
    const prompt = { type: 'system-prompt' as const, id: 'prompt', text: 'Rewritten.' };
    expect(placeThreadEntry(heldInList(held), { kind: 'system-prompt', entry: prompt })).toEqual({ kind: 'replace', entry: prompt });
  });

  test('a compaction transition carries the moment it started into the placement', () => {
    const started: ThreadTranscript = [
      { type: 'compaction', id: 'compaction:run-1', status: 'running', occurredAt: '2026-08-30T10:00:00.000Z' },
    ];
    const placement = placeThreadEntry(heldInList(started), {
      kind: 'compaction',
      entry: { type: 'compaction', id: 'compaction:run-1', status: 'completed', occurredAt: '2026-08-30T10:00:09.000Z' },
    });
    expect(placement).toEqual({
      kind: 'replace',
      entry: { type: 'compaction', id: 'compaction:run-1', status: 'completed', occurredAt: '2026-08-30T10:00:00.000Z' },
    });
  });

  test('a withdrawal names the run own rows, spares the prompt, and is idempotent', () => {
    const first = placeThreadEntry(heldInList(held), { kind: 'stopped', withdrawn: { runId: 'run-1' } });
    expect(first).toEqual({ kind: 'withdraw', ids: ['call-1'] });

    const left = applyThreadEntryPlacements(held, first ? [first] : []);
    expect(left.map((entry) => entry.id)).toEqual(['prompt', 'u-1']);
    expect(placeThreadEntry(heldInList(left), { kind: 'stopped', withdrawn: { runId: 'run-1' } })).toBeNull();
  });

  test('a fact with nothing to place answers null', () => {
    expect(placeThreadEntry(heldInList(held), { kind: 'step' })).toBeNull();
    expect(placeThreadEntry(heldInList([]), { kind: 'stopped', withdrawn: { runId: 'run-9' } })).toBeNull();
  });

  test('applying the placements reproduces the fold, fact for fact', () => {
    const facts: readonly ThreadEventFact[] = [
      { kind: 'message', entry: { type: 'message', id: 'u-2', role: 'user', text: 'More.' } },
      {
        kind: 'tool',
        entry: { type: 'tool', id: 'call-2', runId: 'run-2', toolName: 'grep', toolCallId: 'c', toolState: 'input-available' },
      },
      {
        kind: 'tool',
        entry: { type: 'tool', id: 'call-2', runId: 'run-2', toolName: 'grep', toolCallId: 'c', toolState: 'output-available' },
      },
      { kind: 'system-prompt', entry: { type: 'system-prompt', id: 'prompt:run-2', text: 'Anew.' } },
      { kind: 'stopped', withdrawn: { runId: 'run-1' } },
    ];

    let byArray: ThreadTranscript = held;
    let byPlacement: ThreadTranscript = held;
    const placements: ThreadEntryPlacement[] = [];
    for (const fact of facts) {
      const placement = placeThreadEntry(heldInList(byPlacement), fact);
      if (placement) placements.push(placement);
      byPlacement = placement ? applyThreadEntryPlacements(byPlacement, [placement]) : byPlacement;
      byArray = foldThreadTranscript(byArray, fact);
    }

    expect(byPlacement).toEqual(byArray);
    expect(applyThreadEntryPlacements(held, placements)).toEqual(byArray);
  });
});

describe('TranscriptFold', () => {
  const held: ThreadTranscript = [
    { type: 'system-prompt', id: 'prompt', text: 'You are.' },
    { type: 'message', id: 'u-1', role: 'user', text: 'Hi.' },
    { type: 'tool', id: 'call-1', runId: 'run-1', toolName: 'read', toolCallId: 'c', toolState: 'input-available' },
  ];
  const facts: readonly ThreadEventFact[] = [
    { kind: 'message', entry: { type: 'message', id: 'u-2', runId: 'run-2', role: 'user', text: 'More.' } },
    {
      kind: 'tool',
      entry: { type: 'tool', id: 'call-2', runId: 'run-2', toolName: 'grep', toolCallId: 'c', toolState: 'input-available' },
    },
    {
      kind: 'tool',
      entry: { type: 'tool', id: 'call-2', runId: 'run-2', toolName: 'grep', toolCallId: 'c', toolState: 'output-available' },
    },
    { kind: 'system-prompt', entry: { type: 'system-prompt', id: 'prompt:run-2', text: 'Anew.' } },
    { kind: 'step' },
    { kind: 'stopped', withdrawn: { runId: 'run-1' } },
    { kind: 'message', entry: { type: 'message', id: 'u-3', runId: 'run-3', role: 'user', text: 'Again.' } },
    { kind: 'stopped', withdrawn: { runId: 'run-2' } },
  ];

  test('a batch folded through the index lands what the immutable fold lands', () => {
    const batch = foldTranscriptBatch(held, facts);
    expect(batch.transcript).toEqual(fold(held, facts));
    expect(applyThreadEntryPlacements(held, batch.placements)).toEqual(batch.transcript);
  });

  test('it decides each placement exactly as the list-backed policy does', () => {
    const indexed = new TranscriptFold(held);
    let listed: ThreadTranscript = held;
    for (const fact of facts) {
      expect(indexed.place(fact)).toEqual(placeThreadEntry(heldInList(listed), fact));
      listed = foldThreadTranscript(listed, fact);
    }
    expect(indexed.take()).toEqual(listed);
  });

  test('an entry that transitions to another run leaves the run it came from', () => {
    const seed: ThreadTranscript = [
      { type: 'tool', id: 'call', runId: 'run-1', toolName: 'read', toolCallId: 'c', toolState: 'input-available' },
    ];
    const moved: ThreadEventFact = {
      kind: 'tool',
      entry: { type: 'tool', id: 'call', runId: 'run-2', toolName: 'read', toolCallId: 'c', toolState: 'output-available' },
    };
    const takeBack: ThreadEventFact = { kind: 'stopped', withdrawn: { runId: 'run-1' } };

    expect(foldTranscriptBatch(seed, [moved, takeBack]).transcript).toEqual(fold(seed, [moved, takeBack]));

    const indexed = new TranscriptFold(seed);
    indexed.place(moved);
    expect(indexed.place(takeBack)).toBeNull();
    expect(indexed.take().map((entry) => entry.id)).toEqual(['call']);
  });

  test('re-folding the same suffix over its own result moves nothing', () => {
    const once = foldTranscriptBatch(held, facts);
    expect(foldTranscriptBatch(once.transcript, facts).transcript).toEqual(once.transcript);
  });
});
