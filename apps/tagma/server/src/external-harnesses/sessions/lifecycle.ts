import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Cause, Effect } from 'effect';
import { describeError } from '@runlith/utils/error';
import type { NativeExit } from '@runlith/executions/protocol/execution';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { adoptionKeptName } from '../contract/wire/adoption.js';
import type { HarnessSession, HarnessStorage } from '../../threads/contract/wire/harness/session.js';
import type { JobState } from '../adoption/shellJob.js';

export const recordStorageGate = (
  life: HarnessSession | undefined,
  sessionId: string,
  storage: HarnessStorage,
): 'record' | 'keep' | GateRefusal => {
  if (life?.id !== sessionId || (life.state !== 'starting' && life.state !== 'stopping')) {
    return new GateRefusal('stale-execution', 'The session changed before its launch storage could be recorded.', [
      'read the standing execution session',
    ]);
  }
  if (life.storage === undefined) return 'record';
  return JSON.stringify(life.storage) === JSON.stringify(storage)
    ? 'keep'
    : new GateRefusal('storage-changed', 'The launch environment differs from its recorded storage binding.', [
        'start a new execution after resolving the pending launch',
      ]);
};

export const provisionReason = (owned: string, cause: Cause.Cause<never>): string => {
  const reason = Cause.pretty(cause).split('\n', 1)[0]?.slice(0, 300);
  return `export-unavailable: the launch export directory ${owned} could not be provisioned${reason === undefined || reason.length === 0 ? '' : `: ${reason}`}.`;
};

export const endsAbortedWhenGone = (session: HarnessSession, retiring: boolean | undefined): boolean =>
  session.state === 'stopping' || retiring === true;

export const LOST_LINE =
  "lost: the execution host no longer holds this CLI's terminal — it was replaced or retired — so the process is gone";

export const UNLAUNCHED_LINE = 'unlaunched: the execution host holds no started process for this CLI, so it never ran';

export const causeLine = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.squash(cause);
  return error instanceof GateRefusal ? `${error.message} — ${error.unblock.join('; ')}` : describeError(error);
};

export const shellEndedLine = (execution: string): string =>
  `terminal-ended: the terminal ${execution} this CLI was adopted in ended, so nothing of it is read or typed into any more`;

export const exitLine = (exit: NativeExit): string =>
  exit._tag === 'Code' ? `exited with code ${exit.code}` : `killed by signal ${exit.signal}`;

export const forgetKept = (key: string): Effect.Effect<void> =>
  Effect.tryPromise(() => rm(join(tmpdir(), adoptionKeptName(key)), { force: true })).pipe(
    Effect.catch((cause) => Effect.logWarning('the kept adoption answer could not be removed', { cause })),
  );

export const QUIT_BEAT_MS = 1_500;
export const QUIT_WAIT_MS = 10_000;

export const BACKGROUND_WORDS: Record<Exclude<JobState, 'foreground'>, string> = {
  background: 'The CLI is not in its terminal’s foreground, so these words wait in the queue; nothing is typed into the shell.',
  unread: 'Whether the CLI stands in its terminal’s foreground could not be read, so these words wait in the queue.',
  gone: 'The CLI has left its terminal, so these words wait in the queue for the session’s ending.',
};

export type Measured =
  | { readonly _tag: 'Gone'; readonly failure: string }
  | { readonly _tag: 'Exited'; readonly exit: NativeExit | undefined }
  | { readonly _tag: 'Left' }
  | { readonly _tag: 'Closed' }
  | { readonly _tag: 'Standing' };
