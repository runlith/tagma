import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { hookReports } from '../testing/hookReports.js';
import { transcriptFiles } from '../testing/files.js';
import { keyboardFrame, keyboardRecord } from '../testing/keyboard.js';
import { COMPACTION_BEAT_MS, PROMPT_BEAT_MS, QUIET_WINDOW_MS } from './decide.js';

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const user = line({ role: 'user', message: { content: [] } });
const ended = line({ type: 'turn_ended', status: 'success' });
const aborted = line({ type: 'turn_ended', status: 'aborted', error: 'User aborted/interrupted manually.' });
const path = '/data/cursor.jsonl';
const fixture = Effect.fnUntraced(function* (text = user, located = true) {
  const memory = yield* transcriptFiles();
  yield* memory.files.writeFileString(path, text);
  const world = yield* hookReports({ name: 'cursor', key: 'root', access: memory.access });
  yield* world.store.change(world.id, (facet) =>
    Effect.succeed({
      facet: {
        ...facet,
        execution: { execution: 'cursor-memory', incarnation: 1 },
        session: { ...facet.session!, transcriptPath: located ? path : undefined, storage: { binding: memory.binding, entries: [] } },
      },
      value: undefined,
    }),
  );
  const post = Effect.fnUntraced(function* (name: string, status?: string) {
    yield* TestClock.adjust(1);
    return yield* world.reports.reported(world.id, {
      session: world.session,
      receipt: crypto.randomUUID(),
      event: { hook_event_name: name, session_id: 'root', generation_id: 'gen-1', status },
    });
  });
  yield* post('beforeSubmitPrompt');
  return { ...world, ...memory, post };
});

it.effect('the transcript baseline excludes old ends and a queued word waits for silence before a later end is committed', () =>
  Effect.gen(function* () {
    const old = aborted + user;
    const world = yield* fixture(old);
    const opened = yield* world.world.ledger.activeRun(world.id);
    expect((yield* world.store.read(world.id))?.turn?.offset).toBe(Buffer.byteLength(old));
    yield* world.storage.inbox.put({
      id: 'queued',
      threadId: world.id,
      sender: { kind: 'reader' },
      kind: 'turn',
      body: { text: 'next' },
      occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    });
    yield* world.files.writeFileString(path, old + user + ended);
    expect((yield* world.world.ledger.activeRun(world.id))?.id).toBe(opened?.id);
    yield* TestClock.adjust(QUIET_WINDOW_MS - 1);
    expect((yield* world.world.ledger.activeRun(world.id))?.id).toBe(opened?.id);
    yield* TestClock.adjust(1);
    expect(yield* world.world.ledger.activeRun(world.id)).toBeNull();
    expect((yield* world.world.ledger.runById(opened!.id))?.status).toBe('completed');
  }),
);

it.effect('recovery rearms a persisted quiet turn whose transcript ended while no live watcher stood', () =>
  Effect.gen(function* () {
    const old = aborted + user;
    const world = yield* fixture(old);
    const opened = yield* world.world.ledger.activeRun(world.id);
    yield* world.watch.quieted(world.id);
    yield* world.storage.inbox.put({
      id: 'queued',
      threadId: world.id,
      sender: { kind: 'reader' },
      kind: 'turn',
      body: { text: 'next' },
      occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    });
    yield* world.files.writeFileString(path, old + user + ended);
    yield* TestClock.adjust(QUIET_WINDOW_MS);
    expect((yield* world.world.ledger.activeRun(world.id))?.id).toBe(opened?.id);
    yield* world.watch.rearm(yield* world.store.sessionsStanding('terminal'));
    yield* TestClock.adjust(0);
    expect(yield* world.world.ledger.activeRun(world.id)).toBeNull();
    expect((yield* world.world.ledger.runById(opened!.id))?.status).toBe('completed');
  }),
);

it.effect('an unknown opening offset cannot turn later transcript content into evidence for that run', () =>
  Effect.gen(function* () {
    const world = yield* fixture(user, false);
    const opened = yield* world.world.ledger.activeRun(world.id);
    expect((yield* world.store.read(world.id))?.turn?.offset).toBeNull();
    yield* world.store.change(world.id, (facet) =>
      Effect.succeed({ facet: { ...facet, session: { ...facet.session!, transcriptPath: path } }, value: undefined }),
    );
    yield* world.files.writeFileString(path, user + user + ended);
    yield* world.watch.check(world.id, { returned: true });
    expect((yield* world.store.read(world.id))?.turn?.offset).toBeNull();
    expect((yield* world.world.ledger.activeRun(world.id))?.id).toBe(opened?.id);
  }),
);

it.effect('Cursor transcript abort wins either order of conflicting Stops, while an error without abort fails the run', () =>
  Effect.gen(function* () {
    for (const order of [
      ['aborted', 'error'],
      ['error', 'aborted'],
    ]) {
      const world = yield* fixture();
      const opened = yield* world.world.ledger.activeRun(world.id);
      yield* world.files.writeFileString(path, user + user + aborted);
      for (const status of order) yield* world.post('stop', status);
      expect(yield* world.world.ledger.activeRun(world.id)).toBeNull();
      expect((yield* world.world.ledger.runById(opened!.id))?.status).toBe('aborted');
    }
    const failed = yield* fixture();
    const opened = yield* failed.world.ledger.activeRun(failed.id);
    yield* failed.post('stop', 'error');
    expect(yield* failed.world.ledger.activeRun(failed.id)).toBeNull();
    expect((yield* failed.world.ledger.runById(opened!.id))?.status).toBe('failed');
  }),
);

const CLAUDE_PROMPT = ['● Done.', '────────────────', '❯ okay', '────────────────', '  ⏵⏵ bypass permissions on'];
const CLAUDE_WORKING = ['● Done.', '✻ Thinking… (3s · esc to interrupt)', ...CLAUDE_PROMPT.slice(1)];

const claudeTurn = Effect.fnUntraced(function* (screen: readonly string[]) {
  const memory = yield* transcriptFiles();
  const transcript = '/data/claude.jsonl';
  yield* memory.files.writeFileString(transcript, '');
  const world = yield* hookReports({
    name: 'claude-code',
    key: 'root',
    access: memory.access,
    terminals: { record: () => Effect.succeed(keyboardRecord()) },
    screens: { screen: () => Effect.succeed(keyboardFrame(screen)) },
  });
  yield* world.store.change(world.id, (facet) =>
    Effect.succeed({
      facet: {
        ...facet,
        execution: { execution: 'claude-memory', incarnation: 1 },
        session: { ...facet.session!, transcriptPath: transcript, storage: { binding: memory.binding, entries: [] } },
      },
      value: undefined,
    }),
  );
  yield* TestClock.adjust(1);
  yield* world.reports.reported(world.id, {
    session: world.session,
    receipt: crypto.randomUUID(),
    event: { hook_event_name: 'UserPromptSubmit', session_id: 'root' },
    prompt: 'okay',
  });
  const asked = new Date(yield* Clock.currentTimeMillis).toISOString();
  yield* memory.files.writeFileString(transcript, line({ type: 'user', message: { role: 'user', content: 'okay' }, timestamp: asked }));
  const append = Effect.fnUntraced(function* (record: Record<string, unknown>) {
    yield* TestClock.adjust(1);
    const timestamp = new Date(yield* Clock.currentTimeMillis).toISOString();
    yield* memory.files.writeFileString(transcript, line({ ...record, timestamp }), { flag: 'a' });
  });
  return { ...world, append, opened: yield* world.world.ledger.activeRun(world.id) };
});

it.effect(
  'a Claude turn cut before any answer ends aborted once its screen holds the prompt, while a working screen keeps it running',
  () =>
    Effect.gen(function* () {
      const cut = yield* claudeTurn(CLAUDE_PROMPT);
      const working = yield* claudeTurn(CLAUDE_WORKING);
      yield* TestClock.adjust(QUIET_WINDOW_MS + 2 * PROMPT_BEAT_MS);
      expect(yield* cut.world.ledger.activeRun(cut.id)).toBeNull();
      expect((yield* cut.world.ledger.runById(cut.opened!.id))?.status).toBe('aborted');
      expect((yield* working.world.ledger.activeRun(working.id))?.id).toBe(working.opened?.id);
    }),
);

it.effect(
  'a compaction in the TUI drops the measured context at once and reads the tokens Claude Code kept once its boundary is written',
  () =>
    Effect.gen(function* () {
      const world = yield* claudeTurn(CLAUDE_PROMPT);
      const report = (event: Record<string, unknown>) =>
        Effect.andThen(
          TestClock.adjust(1),
          world.reports.reported(world.id, {
            session: world.session,
            receipt: crypto.randomUUID(),
            event: { session_id: 'root', ...event },
          }),
        );
      const reading = () => Effect.map(world.storage.aggregate.find(world.id), (row) => row?.contextReading);
      yield* world.append({
        type: 'assistant',
        message: {
          id: 'msg-1',
          model: 'claude-opus-5-5',
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 2, cache_read_input_tokens: 900_000, output_tokens: 10 },
        },
      });
      yield* report({ hook_event_name: 'Stop', last_assistant_message: 'done' });
      expect(yield* reading()).toMatchObject({ usage: { inputTokens: 900_002 }, stale: false });
      yield* report({ hook_event_name: 'SessionStart', source: 'compact' });
      expect((yield* reading())?.stale).toBe(true);
      yield* world.append({
        type: 'system',
        subtype: 'compact_boundary',
        compactMetadata: { trigger: 'manual', preTokens: 900_012, postTokens: 24_000 },
      });
      yield* TestClock.adjust(COMPACTION_BEAT_MS);
      expect(yield* reading()).toMatchObject({ usage: { inputTokens: 24_000 }, model: 'claude-opus-5-5', stale: false });
    }),
);
