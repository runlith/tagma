import { Context, Effect } from 'effect';
import type { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { actDigest, callKey } from '@runlith/agent/thread/keyed';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { cannotOn, historyCannot, type HistorySide } from '@runlith/agent/thread/record';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type {
  ThreadRestoreAnswer,
  ThreadRewindAnswer,
  ThreadRewindDraft,
  ThreadRewindPoints,
  ThreadRewindPreview,
} from '@runlith/agent/thread/rewind';
import type { ThreadQueuedTurn } from '@runlith/agent/transcript/live';
import type { ThreadRewindScope } from '@runlith/agent/transcript/eventFold';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { ThreadHarness } from '../contract/service/engine.js';
import type { rewindDraftsSchema } from '../contract/wire/rewind.js';
import { AttachmentFiles } from '../resources/attachments.js';
import type { NativeThreadState } from '../contract/service/state.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import { ThreadLookup } from '../contract/service/reads.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import { gated } from '../projectGate.js';
import { ReaderMarking } from './reader.js';

export class ThreadRewinds extends Context.Service<
  ThreadRewinds,
  {
    rewind(
      threadId: string,
      projectId: number,
      input: { at: string; scope: ThreadRewindScope; key?: string },
    ): Effect.Effect<ThreadRewindAnswer & Drafted, HarnessFailure>;
    restore(
      threadId: string,
      projectId: number,
      input: { rewindId: string; key?: string },
    ): Effect.Effect<ThreadRestoreAnswer, HarnessFailure>;
    preview(
      threadId: string,
      projectId: number,
      input: { at: string; scope: ThreadRewindScope },
    ): Effect.Effect<{ readonly preview: ThreadRewindPreview } & Drafted, HarnessFailure>;
    points(threadId: string, projectId: number): Effect.Effect<ThreadRewindPoints, HarnessFailure>;
    branch(
      threadId: string,
      projectId: number,
      input: { before?: string; key?: string },
    ): Effect.Effect<{ readonly threadId: string; readonly draft: ThreadRewindDraft | null }, HarnessFailure>;
  }
>()('tagma/threads/ThreadRewinds') {}

type Drafted = { readonly drafts: typeof rewindDraftsSchema.Type };

export const makeThreadRewinds = Effect.gen(function* () {
  const harness = yield* ThreadHarness;
  const threads = yield* ThreadLookup;
  const records = yield* ThreadRecords;
  const rollouts = yield* ThreadRollouts;
  const attachments = yield* AttachmentFiles;
  const reader = yield* ReaderMarking;
  const modelThread = (threadId: string, projectId: number, side: HistorySide) =>
    gated(
      records,
      threadId,
      projectId,
      Effect.fnUntraced(function* () {
        const row = yield* threads.find(threadId, OPERATOR_PRINCIPAL);
        const cannot = row === undefined ? null : historyCannot(row.capabilities, side);
        if (row !== undefined && cannot !== null) {
          return yield* new ThreadCallBroke({ cause: cannotOn(row, cannot, row.transport.adapter) });
        }
        yield* rollouts.rehydrate(threadId);
        return harness.threads.handle(threadId, OPERATOR_PRINCIPAL);
      }),
    );

  const draftsOf = (threadId: string, taken: readonly ThreadQueuedTurn[]): Effect.Effect<Drafted['drafts'], ThreadStorageFailed> =>
    Effect.forEach(taken, (turn) =>
      turn.attachments === undefined || turn.attachments.length === 0
        ? Effect.succeed({ id: turn.id, text: turn.text })
        : Effect.map(attachments.addressed(threadId, turn.attachments), (held) => ({
            id: turn.id,
            text: turn.text,
            attachments: held.map((one) => ({
              mime: one.mediaType,
              url: one.url,
              filename: one.filename,
            })),
          })),
    );

  const called = (key: string | undefined) => (key === undefined ? {} : { call: { actor: OPERATOR_PRINCIPAL, key } });

  return ThreadRewinds.of({
    rewind: Effect.fnUntraced(function* (threadId, projectId, input) {
      const handle = yield* modelThread(threadId, projectId, 'point');
      const answer = yield* handle.rewind({ at: input.at, scope: input.scope, ...called(input.key) });
      yield* reader.wrote(threadId);
      return { ...answer, drafts: yield* draftsOf(threadId, answer.taken) };
    }),

    restore: Effect.fnUntraced(function* (threadId, projectId, input) {
      const handle = yield* modelThread(threadId, projectId, 'point');
      const answer = yield* handle.restore({ rewindId: input.rewindId, ...called(input.key) });
      yield* reader.wrote(threadId);
      return answer;
    }),

    preview: (threadId, projectId, input) =>
      Effect.flatMap(modelThread(threadId, projectId, 'point'), (handle) =>
        handle.previewRewind({ at: input.at, scope: input.scope }),
      ).pipe(Effect.flatMap((preview) => Effect.map(draftsOf(threadId, preview.taken), (drafts) => ({ preview, drafts })))),

    points: (threadId, projectId) => Effect.flatMap(modelThread(threadId, projectId, 'point'), (handle) => handle.rewindPoints()),

    branch: Effect.fnUntraced(function* (threadId, projectId, input) {
      const before = input.before;
      const handle = yield* modelThread(threadId, projectId, before === undefined ? 'whole' : 'point');
      const draft = before === undefined ? null : yield* handle.turnDraft(before);
      const born = yield* harness.threads.duplicate({
        ownerId: OPERATOR_PRINCIPAL,
        createdBy: OPERATOR_PRINCIPAL,
        sourceThreadId: threadId,
        cut: before === undefined ? { kind: 'all' } : { kind: 'before', runId: before },
        birth:
          input.key === undefined
            ? undefined
            : {
                evidence: { call: callKey({ operation: 'branch', actor: OPERATOR_PRINCIPAL, key: input.key }) },
                digest: actDigest(['branch', threadId, before ?? null]),
              },
      });
      yield* harness.threads.handle(born.id, OPERATOR_PRINCIPAL).seat();
      return { threadId: born.id, draft };
    }),
  });
});
