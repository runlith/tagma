import type { ThreadSaid } from '@runlith/agent/thread/run/scheduler/inputs';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import type { ThreadAttachmentRef } from '@runlith/agent/transcript/attachments';
import { Context, type Effect } from 'effect';
import type { HarnessExecutionRef } from '../../../threads/contract/wire/harness/observation.js';
import type { HarnessStorage } from '../../../threads/contract/wire/harness/session.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';

export type AdoptionRequest = {
  readonly shell: HarnessExecutionRef;
  readonly job: ProcessWitness;
  readonly key: string;
  readonly cwd: string | null;
  readonly storage?: HarnessStorage;
};

export type SessionProcesses = {
  stop(threadId: string, expectedId?: string): Effect.Effect<'stopped' | 'not-running', HarnessFailure>;
};

export type SessionWords = {
  start(threadId: string, prompt?: string, inputId?: string): Effect.Effect<{ runId: string }, HarnessFailure>;
  send(threadId: string, text: string, attachments?: readonly ThreadAttachmentRef[]): Effect.Effect<ThreadSaid, HarnessFailure>;
};

export class HarnessSessions extends Context.Service<HarnessSessions, SessionWords>()('tagma/external-harnesses/HarnessSessions') {}
