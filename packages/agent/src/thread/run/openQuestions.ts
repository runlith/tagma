import { Effect, type Context } from 'effect';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import type { ThreadRunRow } from '../rows';
import type { ThreadBorderFailed } from '../ThreadBorder';
import type { ThreadStore } from '../ThreadPorts';
import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '../storage/runs';

export const openQuestionsOf = (
  store: Context.Service.Shape<typeof ThreadStore>,
  threadId: string,
  run: ThreadRunRow | null,
): Effect.Effect<readonly ThreadQuestionEntry[], ThreadBorderFailed> =>
  run === null || run.progress.stage !== THREAD_RUN_AWAITING_QUESTION_STAGE
    ? Effect.succeed([])
    : store.openQuestionsOfRun(threadId, run.id);
