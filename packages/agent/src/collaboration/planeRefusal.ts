import { AgentProfileUnknownError } from '../thread/agents/AgentProfile';
import { TransportCannotError, type ThreadRecord, type TransportCapabilityName } from '../thread/record';
import { InboxConflict } from '../thread/storage/inbox';
import { ThreadCallBroke, threadCauseOf } from '../thread/ThreadBorder';
import { ThreadActReusedError } from '../thread/transition/port';
import { ThreadCompactionConflict } from './compaction';
import { PlaneRefused, type PlaneRefusalCode } from './refusals';
import { BirthConflict } from './threads';
import { ThreadRunConflict, ThreadRunRefused } from './runs';

export function planeRefused(code: PlaneRefusalCode, reason: string, unblock?: readonly [string, ...string[]]): ThreadCallBroke {
  return new ThreadCallBroke({ cause: new PlaneRefused(code, reason, unblock) });
}

export function transportCannot(thread: ThreadRecord, capability: TransportCapabilityName): ThreadCallBroke {
  return new ThreadCallBroke({ cause: new TransportCannotError({ threadId: thread.id, capability, adapter: thread.harness }) });
}

export function planeRefusalOf(failure: unknown): PlaneRefused | null {
  const cause = threadCauseOf(failure);
  if (cause instanceof PlaneRefused) return cause;
  if (cause instanceof ThreadRunConflict) {
    return cause.reason === 'running'
      ? new PlaneRefused('thread-running', `A run of ${cause.threadId} is already going.`)
      : new PlaneRefused('key-reused', `This key already opened another run of ${cause.threadId}.`);
  }
  if (cause instanceof ThreadRunRefused && cause.reason === 'not-interrupted') {
    return new PlaneRefused('not-interrupted', cause.message);
  }
  if (cause instanceof AgentProfileUnknownError) return new PlaneRefused('unknown-type', cause.reason);
  if (cause instanceof BirthConflict) {
    return new PlaneRefused(cause.reason === 'name-taken' ? 'name-taken' : 'spawn-conflict', cause.message);
  }
  if (cause instanceof TransportCannotError) return new PlaneRefused('transport-cannot', cause.message);
  if (cause instanceof ThreadActReusedError) return new PlaneRefused('key-reused', cause.message);
  if (cause instanceof ThreadCompactionConflict && cause.reason === 'act-id-reused') {
    return new PlaneRefused(
      'key-reused',
      `thread ${cause.threadId}: this key already asked for another compaction ahead of a task, so a changed task needs a key of its own.`,
    );
  }
  if (cause instanceof InboxConflict) {
    return new PlaneRefused(
      'key-reused',
      `thread ${cause.threadId}: this key already names another act, so a changed call needs a key of its own.`,
    );
  }
  return null;
}
