import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { AgentRunState } from '../agent/AgentRunState';
import { AgentRuntimePolicy, agentGuides } from '../agent/policy/AgentRuntimePolicy';
import type { ThreadView } from '../thread/agents/ThreadAgent';
import type { ThreadTranscriptEntry } from '../transcript/rows';
import { Tool } from '../agent/tool';
import { ASKS_NEVER } from '../permissions/vocabulary';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { inMemoryInboxStorage } from '../thread/storage/InMemoryInboxStorage';
import type { ThreadInboxItemValues, ThreadInboxStorage } from '../thread/storage/inbox';
import type { ThreadRecord } from '../thread/record';
import { ThreadInbox } from '../thread/ThreadPorts';
import { makeCollaborationClosingRule } from './ThreadObligations';
import { Threads } from './threads';
const OWNER = 'owner';
const unused = () => Effect.die('Closing only resolves the requester.');
const world = Effect.fnUntraced(function* (recorded: readonly ThreadTranscriptEntry[] = []) {
  const inbox = inMemoryInboxStorage();
  const standing = new Set(['parent', 'peer', 'child']);
  const recording = activityRecording();
  const collection = Threads.of({
    find: (id) => Effect.succeed(standing.has(id) ? ({ id, principal: OWNER, name: id } as ThreadRecord) : null),
    named: unused,
    lineage: unused,
    list: unused,
    watch: unused,
    birthReceipt: unused,
    readBirth: unused,
    create: unused,
  });
  const create = yield* makeCollaborationClosingRule.pipe(
    Effect.provideService(ThreadInbox, inbox as ThreadInboxStorage<unknown>),
    Effect.provideService(Threads, collection),
  );
  const closing = new AgentRuntimePolicy([create({ id: 'child', ownerId: OWNER, transcript: recorded } as unknown as ThreadView)]);
  const states = new Map<string, AgentRunState>();
  const tool = Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_NEVER,
    description: 'Changes the fixture.',
    parameters: Schema.Struct({}),
    execute: () => Effect.void,
    mutates: true,
  });
  return {
    inbox,
    recording,
    gone: (id: string) => void standing.delete(id),
    task: Effect.fnUntraced(function* (
      id: string,
      from: string,
      at: string,
      run: string | null,
      text = `Build the ${id} part.\nThen report.`,
    ) {
      yield* inbox.put(request(id, from, at, text));
      if (run !== null) {
        yield* inbox.deliver([id], run);
        yield* inbox.acknowledge([id], run);
      }
    }),
    guides: (runId: string, changed: readonly string[], messaging = true) => {
      let run = states.get(runId);
      if (run === undefined) {
        run = new AgentRunState();
        states.set(runId, run);
      }
      const catalog = Object.fromEntries(['write', ...changed, ...(messaging ? ['send_message'] : [])].map((name) => [name, tool]));
      return closing
        .evaluate({
          hook: 'beforeClose',
          runId,
          run,
          invocationKey: runId,
          ordinal: 1,
          modelMessages: [],
          catalog,
          steps: [
            {
              content: [],
              text: '',
              reasoningText: undefined,
              toolCalls: [],
              toolResults: changed.map((toolName, at) => ({ toolName, toolCallId: String(at), output: 'ok' })),
              usage: undefined,
            },
          ],
        })
        .pipe(Effect.map(agentGuides), Effect.provideService(ActivityLog, recording.log));
    },
  };
});
function request(id: string, from: string, at: string, text: string): ThreadInboxItemValues {
  return {
    id,
    threadId: 'child',
    sender: { kind: 'thread', threadId: from, name: from },
    kind: 'task',
    body: { intent: 'task', text, inReplyTo: null },
    occurredAt: at,
  };
}
describe('the closing reminder', () => {
  it.effect('re-entry counts only successful mutations recorded for the same run', () =>
    Effect.gen(function* () {
      const setting = yield* world([
        { type: 'tool', id: 'write-old', runId: 'run-old', toolName: 'write', toolCallId: 'call-old', toolState: 'output-available' },
      ]);
      yield* setting.task('owed', 'parent', '2026-09-23T10:00:00.000Z', 'run-request');
      expect(yield* setting.guides('run-new', [])).toEqual([]);
      expect(yield* setting.guides('run-old', [])).toHaveLength(1);
      const denied = yield* world([
        { type: 'tool', id: 'denied', runId: 'run-denied', toolName: 'write', toolCallId: 'call-denied', toolState: 'output-denied' },
      ]);
      yield* denied.task('owed', 'parent', '2026-09-23T10:00:00.000Z', 'run-request');
      expect(yield* denied.guides('run-denied', [])).toEqual([]);
    }),
  );
  it.effect('a reminder is spent only for its own run, including re-entry from a recorded guide', () =>
    Effect.gen(function* () {
      const setting = yield* world([
        {
          type: 'runtime-guidance',
          id: 'old-guide',
          runId: 'run-old',
          hook: 'beforeStep',
          sequence: 1,
          texts: ['Already reminded.'],
          sources: [{ hook: 'beforeStep', state: { closing: true } }],
        },
      ]);
      yield* setting.task('owed', 'parent', '2026-09-23T10:00:00.000Z', 'run-request');
      expect(yield* setting.guides('run-new', ['write'])).toHaveLength(1);
      expect(yield* setting.guides('run-new', ['write'])).toEqual([]);
      expect(yield* setting.guides('run-old', ['write'])).toEqual([]);
    }),
  );
  it.effect(
    'a changed run is reminded once per requester against the newest request it still owes',
    Effect.fnUntraced(function* () {
      const setting = yield* world();
      yield* setting.task('spawn', 'parent', '2026-09-23T10:00:00.000Z', 'run-1');
      yield* setting.task('more', 'parent', '2026-09-23T11:00:00.000Z', 'run-2', 'Fix the migration.');
      yield* setting.task('review', 'peer', '2026-09-23T12:00:00.000Z', 'run-3');
      const guides = yield* setting.guides('run-9', ['write', 'send_message']);
      expect(guides).toHaveLength(1);
      expect(guides[0]!.state).toEqual({ requests: ['more', 'review'] });
      expect(setting.recording.runNotes('run-9')).toEqual([{ type: 'closing-reminder', requests: ['more', 'review'] }]);
    }),
  );
  it.effect(
    'a run without send_message or with no changes beyond messages is not reminded',
    Effect.fnUntraced(function* () {
      const setting = yield* world();
      yield* setting.task('spawn', 'parent', '2026-09-23T10:00:00.000Z', 'run-1');
      yield* setting.task('more', 'parent', '2026-09-23T11:00:00.000Z', 'run-2', 'Fix the migration.');
      expect(yield* setting.guides('run-9', ['write'], false)).toEqual([]);
      expect(yield* setting.guides('run-9', ['write'])).toHaveLength(1);
      expect(yield* setting.guides('run-3', ['send_message', 'send_task', 'interrupt_agent'])).toEqual([]);
    }),
  );
  it.effect(
    'a requester taken by this run, or a queued or already closed request, owes no reminder',
    Effect.fnUntraced(function* () {
      const setting = yield* world();
      yield* setting.task('spawn', 'parent', '2026-09-23T10:00:00.000Z', null);
      yield* setting.inbox.deliver(['spawn'], 'run-1');
      yield* setting.task('queued', 'peer', '2026-09-23T11:00:00.000Z', null);
      expect(yield* setting.guides('run-1', ['write'])).toEqual([]);
      yield* setting.task('answered', 'peer', '2026-09-23T09:00:00.000Z', 'run-0');
      yield* setting.inbox.closeRequests(['answered'], 'envelope:final:answered');
      expect(yield* setting.guides('run-1', ['write'])).toEqual([]);
    }),
  );
  it.effect(
    'a request whose requester is gone is closed on read and reminds nobody',
    Effect.fnUntraced(function* () {
      const setting = yield* world();
      yield* setting.task('spawn', 'parent', '2026-09-23T10:00:00.000Z', 'run-1');
      setting.gone('parent');
      expect(yield* setting.guides('run-2', ['write'])).toEqual([]);
      expect(setting.inbox.closed.get('spawn')?.by).toBe('requester-gone');
      expect(setting.recording.runNotes('run-2')).toEqual([{ type: 'request-closed', request: 'spawn', by: 'requester-gone' }]);
    }),
  );
});
