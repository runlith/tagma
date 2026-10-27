import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { ThreadSignalConflictError } from '@runlith/agent/thread/run/scheduler/inputs';
import type { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { commandSignalSend, stayIdle, wakeUnlessStopped } from './signals.js';
import type { NativeThreadState } from '../contract/service/state.js';
import type { ThreadLookup } from '../contract/service/reads.js';

const threadId = ThreadId.make('thread-signal-send');
const words = { threadId, id: 'command:exec-1:1:call-1', text: 'A command you left running has ended.' };

const sendingOver = (failure: unknown, row: unknown = { id: threadId }) => {
  const threads = { find: () => Effect.succeed(row) } as unknown as ThreadLookup['Service'];
  const harness = {
    threads: { handle: () => ({ sendSignal: () => (failure === null ? Effect.succeed({ status: 'persisted' }) : Effect.fail(failure)) }) },
  } as unknown as AgentHarness<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>;
  return commandSignalSend(threads, harness, stayIdle);
};

it.live('a signal id already standing with other words is refused for good, never read back as unreachable', () =>
  Effect.gen(function* () {
    const conflict = new ThreadCallBroke({
      cause: new ThreadSignalConflictError({ threadId, signalId: words.id }),
    });
    const answer = yield* sendingOver(conflict)(words);

    expect(answer._tag).toBe('Refused');
    expect(answer._tag === 'Refused' ? answer.reason : '').toContain(words.id);
  }),
);

it.live('a thread host that broke on anything else is unreachable, and the obligation stands', () =>
  Effect.gen(function* () {
    const answer = yield* sendingOver(new ThreadCallBroke({ cause: new Error('the writer is gone') }))(words);

    expect(answer._tag).toBe('Unreachable');
    expect(answer._tag === 'Unreachable' ? answer.reason : '').toContain('the writer is gone');
  }),
);

it.live('a signal naming a project reaches only a thread of that project', () =>
  Effect.gen(function* () {
    const sent: string[] = [];
    const threads = { find: () => Effect.succeed({ id: threadId, projectId: 3 }) } as unknown as ThreadLookup['Service'];
    const harness = {
      threads: {
        handle: () => ({
          sendSignal: (signal: { readonly type: string }) =>
            Effect.sync(() => {
              sent.push(signal.type);
              return { status: 'persisted' };
            }),
        }),
      },
    } as unknown as AgentHarness<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>;
    const send = commandSignalSend(threads, harness, stayIdle, 'terminal-custody');

    expect((yield* send({ ...words, projectId: 4 }))._tag).toBe('NoThread');
    expect((yield* send({ ...words, projectId: 3 }))._tag).toBe('Accepted');
    expect(sent).toEqual(['terminal-custody']);
  }),
);

it.live('an archived thread counts as gone only where the sender asks for it', () =>
  Effect.gen(function* () {
    const archived = { id: threadId, projectId: 3, archivedAt: new Date(1_000) };
    expect((yield* sendingOver(null, archived)(words))._tag).toBe('Accepted');
    const threads = { find: () => Effect.succeed(archived) } as unknown as ThreadLookup['Service'];
    const harness = {
      threads: { handle: () => ({ sendSignal: () => Effect.succeed({ status: 'persisted' }) }) },
    } as unknown as AgentHarness<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>;
    expect((yield* commandSignalSend(threads, harness, stayIdle, 'terminal-custody', true)(words))._tag).toBe('NoThread');
  }),
);

it.live('no such thread is owed nothing, and nothing is sent to invent a recipient', () =>
  Effect.gen(function* () {
    const answer = yield* sendingOver(null, null)(words);

    expect(answer._tag).toBe('NoThread');
  }),
);

const idleChoice = (row: unknown) => {
  const threads = { summary: () => Effect.succeed(row) } as unknown as ThreadLookup['Service'];
  return wakeUnlessStopped(threads)(threadId);
};

it.live('an ending leaves the wake to its thread’s run state, except an archived or missing thread, which only keeps it', () =>
  Effect.gen(function* () {
    expect(yield* idleChoice({ id: threadId, archivedAt: null })).toBe('wake-completed');
    expect(yield* idleChoice({ id: threadId, archivedAt: new Date(1_000) })).toBe('wait');
    expect(yield* idleChoice(undefined)).toBe('wait');
    const unread = { summary: () => Effect.die(new Error('the store is gone')) } as unknown as ThreadLookup['Service'];
    expect(yield* wakeUnlessStopped(unread)(threadId)).toBe('wake-completed');
  }),
);
