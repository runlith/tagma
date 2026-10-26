import { describe, expect } from 'bun:test';
import type { Test } from '@runlith/effect-test';
import { Data, Deferred, Effect, Fiber, type Scope } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { Usage } from '@runlith/llm/schema/events';
import type { ThreadContextReading } from '../../rows';
import type { ThreadTranscriptEntry } from '../../../transcript/rows';
import type { ThreadStorageFactory } from '../storagePort';
import { INSTANCE, OWNER, SCOPE, appendEvent, entry, folding, started, startInput } from './support';
import { threadBranchEvent } from '../../events';
import { branchedTranscript, type ThreadBranchEntries, type ThreadBranchSeed } from '../../storage/aggregate';
import { foldEntries } from '../runLog/support';
class WriteRefused extends Data.TaggedError('WriteRefused')<Record<string, never>> {}
export function describeThreadTranscriptPort<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Test<Scope.Scope | R>,
): void {
  describe(`${name}: thread transcript port`, () => {
    test(
      'the context reading patched inside a running run is in every snapshot before the run settles',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        const reading: ThreadContextReading = {
          usage: new Usage({ inputTokens: 900, cacheReadInputTokens: 600, outputTokens: 40, totalTokens: 940 }),
          contextWindow: 200_000,
          runId: run.id,
          stepNumber: 2,
          provider: thread.provider,
          model: thread.model,
          measuredAt: '2026-08-17T10:00:00.000Z',
          stale: false,
        };
        yield* folding(harness, thread.id, () => Effect.succeed({ contextReading: reading }));
        expect((yield* harness.aggregate.metadata(thread.id))?.contextReading).toEqual(reading);
        expect((yield* harness.aggregate.find(thread.id))?.contextReading).toEqual(reading);
        expect(yield* runs.isRunning(run.id)).toBe(true);
        yield* folding(harness, thread.id, ({ row }) =>
          Effect.succeed({ contextReading: row.contextReading ? { ...row.contextReading, stale: true } : null }),
        );
        expect((yield* harness.aggregate.metadata(thread.id))?.contextReading).toEqual({ ...reading, stale: true });
      }),
    );
    test(
      'the slice reads answer one run, one entry and one thread',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const other = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.aggregate.appendEntries(thread.id, {
          history: [Message.user('one')],
          transcript: [entry('a-1', 'run-a'), entry('b-1', 'run-b'), entry('a-2', 'run-a')],
        });
        yield* harness.aggregate.appendEntries(other.id, { transcript: [entry('a-1', 'run-a')] });
        expect((yield* harness.aggregate.entriesOfRun(thread.id, 'run-a')).map((row) => row.id)).toEqual(['a-1', 'a-2']);
        expect((yield* harness.aggregate.entriesOfRun(thread.id, 'run-b')).map((row) => row.id)).toEqual(['b-1']);
        expect(yield* harness.aggregate.entriesOfRun(thread.id, 'run-none')).toEqual([]);
        expect((yield* harness.aggregate.entryById(thread.id, 'b-1'))?.id).toBe('b-1');
        expect(yield* harness.aggregate.entryById(thread.id, 'nothing')).toBeUndefined();
        expect((yield* harness.aggregate.entryById(other.id, 'a-1'))?.id).toBe('a-1');
        expect(yield* harness.aggregate.entryById(other.id, 'b-1')).toBeUndefined();
        expect(yield* harness.aggregate.historyOf(thread.id)).toHaveLength(1);
        expect(yield* harness.aggregate.historyOf(other.id)).toEqual([]);
        expect(yield* harness.aggregate.historyOf('a-thread-that-never-existed')).toBeNull();
      }),
    );
    test(
      'a branch reads its source`s prefix, and its birth cut over that prefix replays to the transcript the seed names',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const source = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const said = (id: string, runId: string): ThreadTranscriptEntry => ({ type: 'message', id, role: 'user', text: id, runId });
        const journal: readonly ThreadTranscriptEntry[] = [
          { type: 'system-prompt', id: 'prompt-a', text: 'First prompt.' },
          { type: 'system-prompt', id: 'prompt-b', text: 'Second prompt.' },
          entry('report', 'run-0'),
          said('u-1', 'run-1'),
          entry('a-1', 'run-1'),
          { type: 'signal', id: 'task-2', runId: 'run-2', signalType: 'task', addressee: 'transport', text: 'task-2', title: 'parent' },
          entry('a-2', 'run-2'),
        ];
        for (const [at, written] of journal.entries()) {
          yield* appendEvent(harness, { threadId: source.id, id: `${source.id}:${at}`, kind: written.type, payload: { entry: written } });
        }
        const standing = (yield* harness.aggregate.transcriptOf(source.id)) ?? [];
        const prefix = yield* harness.eventLog.eventsAfter(source.id, 0, 1_000);
        const seeds: readonly [ThreadBranchEntries, ThreadBranchSeed['prompts']][] = [
          [{ kind: 'all' }, 'kept'],
          [{ kind: 'all' }, 'dropped'],
          [{ kind: 'turns', turns: 2 }, 'kept'],
          [{ kind: 'turns', turns: 1 }, 'kept'],
          [{ kind: 'kept', taken: ['run-2'] }, 'kept'],
        ];
        for (const [entries, prompts] of seeds) {
          const child = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
          const seed: ThreadBranchSeed = { sourceId: source.id, childId: child.id, entries, prompts };
          yield* harness.transitions.writeAt(
            source.id,
            Effect.fnUntraced(function* (at) {
              const base = yield* harness.aggregate.branch(seed, at.tx);
              const cut = threadBranchEvent({ hidden: entries.kind === 'kept' ? entries.taken : [], prompts, from: base.from, cuts: [] });
              yield* harness.eventLog.append({ threadId: child.id, id: `${child.id}:birth`, kind: cut.kind, payload: cut.payload }, at.tx);
            }),
          );
          const carried = (yield* harness.aggregate.transcriptOf(child.id)) ?? [];
          expect(carried.map((row) => row.id)).toEqual(branchedTranscript(standing, entries, prompts).map((row) => row.id));
          const events = yield* harness.eventLog.eventsAfter(child.id, 0, 1_000);
          expect(events.slice(0, prefix.length).map((row) => row.payload)).toEqual(prefix.map((row) => row.payload));
          expect(foldEntries(events).map((row) => row.id)).toEqual(carried.map((row) => row.id));
        }
      }),
    );
    test(
      'the open questions of a run read alone: other runs, other kinds and answered questions stay out',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const asked = (id: string, runId: string, status: 'open' | 'answered'): ThreadTranscriptEntry => ({
          type: 'question',
          id,
          runId,
          questionId: `ask:${id}`,
          questions: [],
          toolCalls: [],
          status,
        });
        yield* harness.aggregate.appendEntries(thread.id, {
          transcript: [
            entry('m-1', 'run-a'),
            asked('q-open', 'run-a', 'open'),
            asked('q-done', 'run-a', 'answered'),
            asked('q-other', 'run-b', 'open'),
          ],
        });
        expect((yield* harness.aggregate.openQuestionsOfRun(thread.id, 'run-a')).map((row) => row.id)).toEqual(['q-open']);
        expect(yield* harness.aggregate.openQuestionsOfRun(thread.id, 'run-none')).toEqual([]);
        expect(yield* harness.aggregate.questionById(thread.id, 'ask:q-done')).toMatchObject({ id: 'q-done', status: 'answered' });
        expect(yield* harness.aggregate.questionById(thread.id, 'unknown')).toBeUndefined();
        expect(yield* harness.aggregate.questionById('another-thread', 'ask:q-done')).toBeUndefined();
      }),
    );
    test(
      'the frozen prompt reads alone, without the row that carries it',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const other = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        expect(yield* harness.aggregate.systemPromptOf(thread.id)).toMatchObject({ systemPrompt: null, pendingSystemPrompt: null });
        expect(yield* harness.aggregate.systemPromptOf('a-thread-that-never-existed')).toBeUndefined();
        yield* harness.aggregate.update(thread.id, { systemPrompt: 'frozen', pendingSystemPrompt: 'waiting' });
        expect(yield* harness.aggregate.systemPromptOf(thread.id)).toMatchObject({
          systemPrompt: 'frozen',
          pendingSystemPrompt: 'waiting',
        });
        expect(yield* harness.aggregate.systemPromptOf(other.id)).toMatchObject({ systemPrompt: null, pendingSystemPrompt: null });
        const metadata = yield* harness.aggregate.metadata(thread.id);
        expect(metadata).toBeDefined();
        expect(metadata).not.toHaveProperty('systemPrompt');
        expect(metadata).not.toHaveProperty('pendingSystemPrompt');
      }),
    );
    test(
      'concurrent atomic updates never lose each other`s entries',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* Effect.forEach(
          ['a', 'b'],
          (id) => folding(harness, thread.id, () => Effect.succeed({ placements: [{ kind: 'append', entry: entry(id) }] })),
          { concurrency: 'unbounded' },
        );
        const logs = yield* harness.aggregate.logs(thread.id);
        expect((logs?.transcript ?? []).map((item) => item.id).sort()).toEqual(['a', 'b']);
      }),
    );
    test(
      'an append racing an atomic projection loses neither',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* Effect.all(
          [
            harness.aggregate.appendEntries(thread.id, { transcript: [entry('appended')] }),
            folding(harness, thread.id, () => Effect.succeed({ placements: [{ kind: 'append', entry: entry('projected') }] })),
            harness.aggregate.appendEntries(thread.id, { transcript: [entry('appended-2')] }),
          ],
          { concurrency: 'unbounded' },
        );
        const logs = yield* harness.aggregate.logs(thread.id);
        expect((logs?.transcript ?? []).map((item) => item.id).sort()).toEqual(['appended', 'appended-2', 'projected']);
      }),
    );
    test(
      'a window answers the newest entries and pages back to the start of the transcript',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const ids = Array.from({ length: 5 }, (_unused, index) => `e-${index}`);
        yield* harness.aggregate.appendEntries(thread.id, { transcript: ids.map((id) => entry(id)) });
        const newest = yield* harness.aggregate.transcriptWindow(thread.id, { limit: 2, bytes: 1_000_000 });
        expect(newest?.entries.map((held) => held.id)).toEqual(['e-3', 'e-4']);
        expect(newest?.before).not.toBeNull();
        const walked: string[] = [];
        let cursor = newest?.before ?? null;
        while (cursor !== null) {
          const page = yield* harness.aggregate.transcriptWindow(thread.id, { before: cursor, limit: 2, bytes: 1_000_000 });
          walked.unshift(...(page?.entries ?? []).map((held) => held.id));
          cursor = page?.before ?? null;
        }
        expect(walked).toEqual(ids.slice(0, 3));
      }),
    );
    test(
      'a window stops at the byte budget and never answers an empty page',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const fat = (id: string): ThreadTranscriptEntry => ({ type: 'message', id, role: 'assistant', text: 'x'.repeat(380) });
        yield* harness.aggregate.appendEntries(thread.id, { transcript: ['a', 'b', 'c'].map(fat) });
        const bounded = yield* harness.aggregate.transcriptWindow(thread.id, { limit: 10, bytes: 900 });
        expect(bounded?.entries.map((held) => held.id)).toEqual(['b', 'c']);
        const single = yield* harness.aggregate.transcriptWindow(thread.id, { limit: 10, bytes: 1 });
        expect(single?.entries.map((held) => held.id)).toEqual(['c']);
      }),
    );
    test(
      'a window answers an empty page for a silent thread and nothing for a missing one',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const empty = yield* harness.aggregate.transcriptWindow(thread.id, { limit: 5, bytes: 1_000_000 });
        expect(empty).toEqual({ entries: [], before: null });
        expect(yield* harness.aggregate.transcriptWindow('missing-thread', { limit: 5, bytes: 1_000_000 })).toBeNull();
      }),
    );
    test(
      'a window reflects entries that transitioned in place and runs that were taken back',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* folding(harness, thread.id, () =>
          Effect.succeed({
            placements: [
              { kind: 'append' as const, entry: { type: 'message', id: 'kept', role: 'assistant', text: 'kept' } },
              {
                kind: 'append' as const,
                entry: { type: 'tool', id: 'call', runId: 'run-1', toolName: 'read', toolCallId: 'call', toolState: 'input-available' },
              },
              { kind: 'append' as const, entry: { type: 'message', id: 'after', role: 'assistant', text: 'after' } },
            ],
          }),
        );
        yield* folding(harness, thread.id, () =>
          Effect.succeed({
            placements: [
              {
                kind: 'replace' as const,
                entry: { type: 'tool', id: 'call', runId: 'run-1', toolName: 'read', toolCallId: 'call', toolState: 'output-available' },
              },
            ],
          }),
        );
        const settled = yield* harness.aggregate.transcriptWindow(thread.id, { limit: 10, bytes: 1_000_000 });
        expect(settled?.entries.map((held) => held.id)).toEqual(['kept', 'call', 'after']);
        expect(settled?.entries[1]).toMatchObject({ toolState: 'output-available' });
        yield* folding(harness, thread.id, () => Effect.succeed({ placements: [{ kind: 'withdraw' as const, ids: ['call'] }] }));
        const withdrawn = yield* harness.aggregate.transcriptWindow(thread.id, { limit: 10, bytes: 1_000_000 });
        expect(withdrawn?.entries.map((held) => held.id)).toEqual(['kept', 'after']);
      }),
    );
    test(
      'an atomic update sees a committed write, never a half-written one',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const seen: number[] = [];
        yield* Effect.forEach(
          [1, 2],
          (step) =>
            folding(
              harness,
              thread.id,
              Effect.fnUntraced(function* ({ tx }) {
                seen.push(((yield* harness.aggregate.transcriptOf(thread.id, tx)) ?? []).length);
                yield* Effect.yieldNow;
                return { placements: [{ kind: 'append', entry: entry(`step-${step}`) }] };
              }),
            ),
          { concurrency: 'unbounded' },
        );
        expect(seen.sort()).toEqual([0, 1]);
      }),
    );
    test(
      'a reader meeting an open writer sees committed state, and a rollback leaves it so',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const reached = yield* Deferred.make<void>();
        const released = yield* Deferred.make<void>();
        const doomed = yield* Effect.forkScoped(
          Effect.flip(
            harness.transitions.writeAt(
              thread.id,
              Effect.fnUntraced(function* ({ tx }) {
                yield* harness.aggregate.update(thread.id, { model: 'uncommitted' }, tx);
                yield* Deferred.succeed(reached, undefined);
                yield* Deferred.await(released);
                return yield* new WriteRefused({});
              }),
            ),
          ),
        );
        yield* Effect.addFinalizer(() => Deferred.succeed(released, undefined));
        yield* Deferred.await(reached);
        expect(yield* harness.transitions.readAt(thread.id, ({ row }) => Effect.succeed(row.model))).toBe(thread.model);
        expect((yield* harness.aggregate.find(thread.id))?.model).toBe(thread.model);
        yield* Deferred.succeed(released, undefined);
        expect(yield* Fiber.join(doomed)).toBeInstanceOf(WriteRefused);
        expect((yield* harness.aggregate.find(thread.id))?.model).toBe(thread.model);
      }),
    );
    test(
      'deleting a thread takes everything keyed by it',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* started(runs.createRun(startInput(thread)));
        yield* harness.aggregate.appendEntries(thread.id, { transcript: [entry('a')] });
        yield* harness.aggregate.delete([thread.id]);
        expect(yield* harness.aggregate.find(thread.id)).toBeUndefined();
        expect(yield* harness.aggregate.logs(thread.id)).toBeNull();
        expect(yield* runs.latestRun(thread.id)).toBeNull();
      }),
    );
  });
}
