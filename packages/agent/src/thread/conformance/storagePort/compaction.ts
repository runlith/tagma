import { describe, expect } from 'bun:test';
import type { Test } from '@runlith/effect-test';
import { Data, Effect, type Scope } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import type { ThreadStorageFactory } from '../storagePort';
import type { ThreadCompactionCheckpointRow } from '../../rows';
import type { ThreadPrunedToolCall } from '../../storage/compaction';
import { OWNER, SCOPE, entry, folding } from './support';
class FoldRefused extends Data.TaggedError('FoldRefused')<Record<string, never>> {}
export function describeThreadCompactionPort<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Test<Scope.Scope | R>,
): void {
  describe(`${name}: thread compaction port`, () => {
    test(
      'a checkpoint joins the caller unit: it rolls back with it, and an identical one is idempotent',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.aggregate.appendEntries(thread.id, {
          history: [Message.user('one'), Message.user('two')],
          transcript: [entry('a')],
        });
        const settle = (hash: string, summary: string, fold?: readonly Message[]) =>
          folding(
            harness,
            thread.id,
            Effect.fnUntraced(function* ({ tx }) {
              const row = yield* harness.compaction.writeCheckpointIn(
                {
                  threadId: thread.id,
                  sourceRunId: null,
                  coveredMessageCount: 1,
                  coveredPrefixHash: hash,
                  summary,
                  usage: null,
                },
                tx,
              );
              written = row;
              expect((yield* harness.aggregate.historyOf(thread.id, tx))?.length).toBe(2);
              return fold ? { history: fold } : null;
            }),
          );
        let written: ThreadCompactionCheckpointRow | undefined;
        yield* settle('prefix-1', 'summary', [Message.assistant('summary'), Message.user('two')]);
        const first = written!;
        expect(first.coveredMessageCount).toBe(1);
        expect((yield* harness.aggregate.find(thread.id))?.history).toEqual([Message.assistant('summary'), Message.user('two')]);
        yield* settle('prefix-1', 'other summary');
        expect(written!.id).toBe(first.id);
        yield* settle('prefix-2', 'the second generation');
        expect(written!.id).not.toBe(first.id);
        expect(yield* harness.compaction.latestCheckpoint(thread.id)).toEqual(
          expect.objectContaining({ coveredPrefixHash: 'prefix-2', summary: 'the second generation' }),
        );
        expect(
          yield* Effect.flip(
            folding(
              harness,
              thread.id,
              Effect.fnUntraced(function* ({ tx }) {
                yield* harness.compaction.writeCheckpointIn(
                  {
                    threadId: thread.id,
                    sourceRunId: null,
                    coveredMessageCount: 1,
                    coveredPrefixHash: 'rolled-back',
                    summary: 'never stands',
                    usage: null,
                  },
                  tx,
                );
                return yield* Effect.fail(new FoldRefused({}));
              }),
            ),
          ),
        ).toBeInstanceOf(FoldRefused);
        expect(yield* harness.compaction.latestCheckpoint(thread.id)).toEqual(expect.objectContaining({ coveredPrefixHash: 'prefix-2' }));
      }),
    );
    test(
      'a pruning mark is monotone, idempotent, and scoped to its thread',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const other = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        expect(yield* harness.compaction.prunedToolCalls(thread.id)).toEqual(new Set());
        expect(yield* harness.compaction.prunedToolCallVolume(thread.id)).toEqual({ count: 0, tokens: 0 });
        const mark = (threadId: string, calls: readonly ThreadPrunedToolCall[]) =>
          folding(harness, threadId, ({ tx }) => Effect.map(harness.compaction.markToolCallsPrunedIn(threadId, calls, tx), () => null));
        yield* mark(thread.id, [
          { toolCallId: 'call-1', tokens: 400 },
          { toolCallId: 'call-2', tokens: 600 },
        ]);
        yield* mark(thread.id, [
          { toolCallId: 'call-2', tokens: 6_000 },
          { toolCallId: 'call-3', tokens: 1_000 },
        ]);
        expect(
          yield* Effect.flip(
            folding(
              harness,
              thread.id,
              Effect.fnUntraced(function* ({ tx }) {
                yield* harness.compaction.markToolCallsPrunedIn(thread.id, [{ toolCallId: 'call-4', tokens: 70 }], tx);
                return yield* Effect.fail(new FoldRefused({}));
              }),
            ),
          ),
        ).toBeInstanceOf(FoldRefused);
        expect(yield* harness.compaction.prunedToolCalls(thread.id)).toEqual(new Set(['call-1', 'call-2', 'call-3']));
        expect(yield* harness.compaction.prunedToolCallVolume(thread.id)).toEqual({
          count: 3,
          tokens: 2_000,
        });
        expect(yield* harness.compaction.prunedToolCalls(other.id)).toEqual(new Set());
        expect(yield* harness.compaction.prunedToolCallVolume(other.id)).toEqual({ count: 0, tokens: 0 });
      }),
    );
    test(
      'a mark retires inside the fold unit, and a failed unit keeps the decision',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const other = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const mark = (threadId: string, calls: readonly ThreadPrunedToolCall[]) =>
          folding(harness, threadId, ({ tx }) => Effect.map(harness.compaction.markToolCallsPrunedIn(threadId, calls, tx), () => null));
        yield* mark(thread.id, [
          { toolCallId: 'call-1', tokens: 100 },
          { toolCallId: 'call-2', tokens: 200 },
          { toolCallId: 'call-3', tokens: 300 },
        ]);
        yield* mark(other.id, [{ toolCallId: 'call-1', tokens: 50 }]);
        expect(
          yield* Effect.flip(
            folding(
              harness,
              thread.id,
              Effect.fnUntraced(function* ({ tx }) {
                yield* harness.compaction.retirePrunedToolCallsIn(thread.id, ['call-1'], tx);
                return yield* Effect.fail(new FoldRefused({}));
              }),
            ),
          ),
        ).toBeInstanceOf(FoldRefused);
        expect(yield* harness.compaction.prunedToolCalls(thread.id)).toEqual(new Set(['call-1', 'call-2', 'call-3']));
        yield* folding(
          harness,
          thread.id,
          Effect.fnUntraced(function* ({ tx }) {
            yield* harness.compaction.retirePrunedToolCallsIn(thread.id, [], tx);
            yield* harness.compaction.retirePrunedToolCallsIn(thread.id, ['call-1', 'call-3'], tx);
            return null;
          }),
        );
        expect(yield* harness.compaction.prunedToolCalls(thread.id)).toEqual(new Set(['call-2']));
        expect(yield* harness.compaction.prunedToolCallVolume(thread.id)).toEqual({ count: 1, tokens: 200 });
        expect(yield* harness.compaction.prunedToolCalls(other.id)).toEqual(new Set(['call-1']));
      }),
    );
  });
}
