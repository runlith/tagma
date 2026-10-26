import { Context, Effect, Layer } from 'effect';
import type { AgentApprovalMode } from '../../agent/contracts';
import { ApprovalModes } from '../../modes/ApprovalModes';
import type { ThreadRow } from '../rows';
import type { ThreadSnapshot } from '../state';
import { ThreadCallBroke, threadCauseOf, type ThreadBorderFailed } from '../ThreadBorder';
import { ThreadStore } from '../ThreadPorts';
import { Questions } from './Questions';
import { ThreadInteractionConflictError } from './ThreadQuestion';
import { ModeLaw } from '../../modes/ModeLaw';
import { ThreadSnapshots } from './ThreadSnapshots';
import { bypassedAnswers } from './ToolQuestion';

export class ThreadModes extends Context.Service<
  ThreadModes,
  {
    move(thread: ThreadRow, mode: AgentApprovalMode): Effect.Effect<ThreadSnapshot, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadModes') {}

export const threadModesLayer: Layer.Layer<ThreadModes, never, Questions | ModeLaw | ThreadSnapshots | ThreadStore | ApprovalModes> =
  Layer.effect(
    ThreadModes,
    Effect.gen(function* () {
      const modes = yield* ApprovalModes;
      const questions = yield* Questions;
      const laws = yield* ModeLaw;
      const snapshots = yield* ThreadSnapshots;
      const store = yield* ThreadStore;
      return ThreadModes.of({
        move: Effect.fnUntraced(function* (thread, id) {
          const mode = yield* modes.get(id).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
          yield* store.update(thread.id, {
            authority: { ...thread.authority, mode: mode.id, bypassFrom: mode.elevated ? thread.id : null },
          });
          laws.move(thread.id, mode.id);
          if (mode.confirmsWaiting) {
            for (const question of yield* questions.open(thread.id)) {
              if (question.deliveryUnknown === true || question.answers !== undefined) continue;
              const answers = bypassedAnswers(question);
              if (answers === null) continue;
              yield* questions.answer(thread.id, question.questionId, answers).pipe(
                Effect.catchIf(
                  (failure) => threadCauseOf(failure) instanceof ThreadInteractionConflictError,
                  () => Effect.void,
                ),
              );
            }
          }
          yield* snapshots.publish(thread.id);
          return yield* snapshots.snapshot(thread.id);
        }),
      });
    }),
  );
