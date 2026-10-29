import { Context, type Effect } from 'effect';
import type { PendingRuntimeGuide } from '../../../agent/contracts';
import type { AgentToolDoor } from '../../../agent/door/AgentToolDoor';
import type { ThreadQuestionEntry } from '../../../transcript/entries';
import type { ThreadRow, ThreadRunRow } from '../../rows';
import type { ThreadBorderFailed } from '../../ThreadBorder';
import type { ThreadStreamQuestionResult } from '../ThreadStreamSink';
import type { ThreadRunRef } from '../ThreadRunLedger';
import type { RunParked } from '../lifecycle/RunLifecycle';
import type { Asking, QuestionOutcome, QuestionRefusal } from '../Questions';

export type ParkQuestion = (
  run: ThreadRunRef,
  asked: ThreadQuestionEntry | null,
  door: AgentToolDoor | null,
  untold?: readonly PendingRuntimeGuide[],
) => Effect.Effect<RunParked | null, ThreadBorderFailed>;

export type AskQuestion = (asking: Asking) => Effect.Effect<QuestionOutcome | QuestionRefusal | null, ThreadBorderFailed>;

export class QuestionIntake extends Context.Service<
  QuestionIntake,
  {
    park: ParkQuestion;
    ask: AskQuestion;
  }
>()('@runlith/agent/QuestionIntake') {}

export type Relaunch = (
  thread: ThreadRow,
  run: ThreadRunRow,
  answered: ThreadStreamQuestionResult,
) => Effect.Effect<void, ThreadBorderFailed, QuestionIntake>;

export class QuestionRelaunch extends Context.Service<
  QuestionRelaunch,
  {
    relaunch: Relaunch;
  }
>()('@runlith/agent/QuestionRelaunch') {}
