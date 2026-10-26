import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { assistantMessageEntryId, signalEntryId, toolEntryId } from '@runlith/agent/transcript/entryNames';
import { entryOf } from '@runlith/agent/transcript/kinds';
import type { HarnessReportInput } from '../../threads/contract/wire/harness/observation.js';
import { hookReports } from '../testing/hookReports.js';
import { APPROVAL, started } from '@runlith/agent/thread/conformance/lifecycleWorld';
import { TerminalWords } from '../terminal/words.js';
import { transcriptFiles } from '../testing/files.js';
import { inputWords } from '../adapter/input.js';

type Reports = Effect.Success<ReturnType<typeof hookReports>>;
const post = Effect.fnUntraced(function* (
  world: Reports,
  name: string,
  over: Record<string, unknown> = {},
  input: HarnessReportInput = {},
) {
  yield* TestClock.adjust(1);
  return yield* world.reports.reported(world.id, {
    session: world.session,
    receipt: crypto.randomUUID(),
    ...input,
    event: { hook_event_name: name, session_id: 'root', ...over },
  });
});
const current = (world: Reports) => Effect.map(world.world.ledger.activeRun(world.id), (run) => run?.id ?? null);

it.effect('a marker with operator words reads the launched run, and a marker arriving after displacement belongs to its reader run', () =>
  Effect.gen(function* () {
    const memory = yield* transcriptFiles();
    const path = '/data/claude.jsonl';
    yield* memory.files.writeFileString(path, '');
    const world = yield* hookReports({ name: 'claude-code', key: 'root', access: memory.access });
    yield* world.store.change(world.id, (facet) =>
      Effect.succeed({
        facet: {
          ...facet,
          execution: { execution: 'memory-cli', incarnation: 1 },
          session: { ...facet.session!, transcriptPath: path, storage: { binding: memory.binding, entries: [] } },
        },
        value: undefined,
      }),
    );
    const run = started(yield* world.world.lifecycle.create(world.world.startFrom, APPROVAL, { kind: 'turn' })).run;
    world.open.add(run.id, world.id);
    yield* world.journal.open(run, (yield* world.store.read(world.id))!, []);
    const words = new TerminalWords(world.store, world.journal);
    const first = (yield* world.storage.inbox.put({
      id: 'first-marker',
      threadId: world.id,
      sender: { kind: 'reader' },
      kind: 'turn',
      body: { text: 'work' },
      occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    })).item;
    yield* world.storage.inbox.deliver([first.id], run.id);
    yield* words.intend(world.id, run.id, [first.id], 'work', undefined);
    yield* words.sending(world.id, run.id, [first.id], undefined);
    yield* words.accepted(world.id, null, [first.id]);
    yield* post(world, 'UserPromptSubmit', { prompt_id: 'p1' }, { inputs: [first.id], prompt: 'please also cover the retry' });
    expect(yield* current(world)).toBe(run.id);
    expect((yield* world.storage.inbox.receipt(first.id))?.state).toBe('acknowledged');
    expect((yield* world.storage.aggregate.entriesOfRun(world.id, run.id)).filter(entryOf('message')).map((entry) => entry.text)).toContain(
      'please also cover the retry',
    );
    const late = (yield* world.storage.inbox.put({
      id: 'late-marker',
      threadId: world.id,
      sender: { kind: 'reader' },
      kind: 'signal',
      body: { type: 'steer', addressee: 'transport', text: 'later work' },
      occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    })).item;
    yield* world.storage.inbox.deliver([late.id], run.id);
    yield* words.steered(world.id, run.id, [late.id], undefined);
    yield* words.sending(world.id, run.id, [late.id], undefined);
    yield* words.accepted(world.id, null, [late.id]);
    yield* world.store.change(world.id, (facet) =>
      Effect.succeed({ facet: { ...facet, turn: { ...facet.turn!, turn: null } }, value: undefined }),
    );
    yield* post(world, 'UserPromptSubmit', { prompt_id: 'own' }, { prompt: 'my own line' });
    const reading = yield* current(world);
    expect(reading).not.toBe(run.id);
    expect((yield* world.world.ledger.runById(run.id))?.status).toBe('aborted');
    yield* memory.files.writeFileString(
      path,
      `${JSON.stringify({ type: 'user', sessionId: 'root', timestamp: new Date(yield* Clock.currentTimeMillis).toISOString(), message: { role: 'user', content: inputWords(late.id, 'later work') } })}\n`,
    );
    yield* post(world, 'Notification', { notification_type: 'idle_prompt' });
    expect(yield* current(world)).toBe(reading);
    expect((yield* world.storage.inbox.receipt(late.id))?.state).toBe('acknowledged');
    expect(yield* world.storage.aggregate.entryById(world.id, signalEntryId(late.id))).toMatchObject({ type: 'signal', runId: reading });
    expect((yield* world.store.read(world.id))?.unread ?? []).toEqual([]);
  }),
);

it.effect('hook diagnostics share the operator run with its ordinary tool and Stop retains the final answer', () =>
  Effect.gen(function* () {
    const world = yield* hookReports({ name: 'claude-code', key: 'root' });
    yield* post(world, 'UserPromptSubmit', { prompt: 'work', prompt_id: 'p1' });
    const opened = yield* current(world);
    expect(opened).not.toBeNull();
    const diagnostics = ['invalid-json', 'invalid-shape'].map((id) => ({
      id,
      tool: 'record_write',
      subject: `/queue/${id}.json`,
      done: true,
      failed: true,
      output: id,
    }));
    yield* post(world, 'PreToolUse', { prompt_id: 'p1' }, { call: { id: 'ordinary-call', tool: 'Read', subject: 'a.ts' }, diagnostics });
    expect(yield* current(world)).toBe(opened);
    expect(yield* world.storage.aggregate.entryById(world.id, toolEntryId('ordinary-call'))).toMatchObject({
      toolState: 'input-available',
      execution: { state: 'started' },
      runId: opened,
    });
    for (const diagnostic of diagnostics)
      expect(yield* world.storage.aggregate.entryById(world.id, toolEntryId(diagnostic.id))).toMatchObject({
        toolState: 'output-error',
        runId: opened,
      });
    yield* post(world, 'Stop', { prompt_id: 'p1' }, { said: { last_assistant_message: 'complete' } });
    expect(yield* current(world)).toBeNull();
    expect(yield* world.storage.aggregate.entryById(world.id, assistantMessageEntryId(opened!, 0))).toMatchObject({
      type: 'message',
      role: 'assistant',
      text: 'complete',
      runId: opened,
    });
  }),
);

it.effect(
  'root generations exclude old and vendor-child Stops, close a prior turn without Stop, and accept follow-ups carrying its prompt id',
  () =>
    Effect.gen(function* () {
      const world = yield* hookReports({ name: 'claude-code', key: 'root' });
      const before = new Date((yield* Clock.currentTimeMillis) - 60_000).toISOString();
      yield* post(world, 'UserPromptSubmit', { prompt: 'First', prompt_id: 'turn-1' });
      const first = yield* current(world);
      expect(first).not.toBeNull();
      yield* post(world, 'Stop', {}, { capturedAt: before });
      expect(yield* current(world)).toBe(first);
      yield* post(world, 'Stop', { agent_id: 'child-1' });
      expect(yield* current(world)).toBe(first);
      yield* post(world, 'UserPromptSubmit', { prompt: 'Second', prompt_id: 'turn-2' });
      const second = yield* current(world);
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);
      expect((yield* world.world.ledger.runById(first!))?.status).toBe('completed');
      expect(world.activities.activities().find((row) => row.opened.run === first)?.ended).toMatchObject({
        outcome: 'ok',
        result: { finish: 'completed' },
      });
      yield* post(world, 'Stop');
      expect(yield* current(world)).toBeNull();
      yield* post(world, 'UserPromptSubmit', { prompt: 'Follow-up', prompt_id: 'turn-2' });
      const third = yield* current(world);
      expect(third).not.toBeNull();
      expect(third).not.toBe(second);
      yield* post(world, 'Stop', { prompt_id: 'turn-3' });
      expect(yield* current(world)).toBeNull();
    }),
);

it.effect('an operator prompt displacing an unclaimed launched turn cancels its committed run and activity without ending the CLI', () =>
  Effect.gen(function* () {
    const world = yield* hookReports({ name: 'claude-code', key: 'root' });
    yield* post(world, 'UserPromptSubmit', { prompt_id: 'launched' }, { prompt: 'Work' });
    yield* post(world, 'PreToolUse', { prompt_id: 'launched' }, { call: { id: 'launched-call', tool: 'Read', subject: 'a.ts' } });
    const first = yield* current(world);
    expect(first).not.toBeNull();
    yield* world.store.change(world.id, (facet) =>
      Effect.succeed({ facet: facet.turn === undefined ? facet : { ...facet, turn: { ...facet.turn, turn: null } }, value: undefined }),
    );
    yield* post(world, 'UserPromptSubmit', { prompt_id: 'operator' }, { prompt: 'a line of my own' });
    const second = yield* current(world);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect((yield* world.store.read(world.id))?.session?.state).toBe('running');
    expect((yield* world.world.ledger.runById(first!))?.status).toBe('aborted');
    expect(world.activities.activities().find((row) => row.opened.run === first)?.ended).toMatchObject({
      outcome: 'cancelled',
      result: { finish: 'aborted' },
    });
  }),
);

it.effect('Codex reuses its last turn id for a fresh run, while a second Cursor Stop cannot affect the next generation', () =>
  Effect.gen(function* () {
    const codex = yield* hookReports({ name: 'codex', key: 'root' });
    yield* post(codex, 'UserPromptSubmit', { prompt: 'First', turn_id: 'turn-1' });
    const first = yield* current(codex);
    expect(first).not.toBeNull();
    yield* post(codex, 'Stop', { turn_id: 'turn-1' });
    expect(yield* current(codex)).toBeNull();
    yield* post(codex, 'UserPromptSubmit', { prompt: 'Late words', turn_id: 'turn-1' });
    const second = yield* current(codex);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    yield* post(codex, 'Stop', { turn_id: 'turn-1' });
    expect(yield* current(codex)).toBeNull();
    const cursor = yield* hookReports({ name: 'cursor', key: 'root' });
    yield* post(cursor, 'beforeSubmitPrompt', { generation_id: 'gen-1' });
    const aborted = yield* current(cursor);
    expect(aborted).not.toBeNull();
    yield* post(cursor, 'stop', { generation_id: 'gen-1', status: 'aborted' });
    expect(yield* current(cursor)).toBeNull();
    expect((yield* cursor.world.ledger.runById(aborted!))?.status).toBe('aborted');
    expect(
      (yield* cursor.storage.aggregate.entriesOfRun(cursor.id, aborted!)).filter((entry) => entry.type === 'interruption'),
    ).toHaveLength(0);
    yield* post(cursor, 'beforeSubmitPrompt', { generation_id: 'gen-2' });
    const next = yield* current(cursor);
    expect(next).not.toBeNull();
    yield* post(cursor, 'stop', { generation_id: 'gen-1', status: 'error' });
    expect(yield* current(cursor)).toBe(next);
  }),
);
