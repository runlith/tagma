import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { Clock, Deferred, Effect, Fiber, Schema } from 'effect';
import { TestClock, TestConsole } from 'effect/testing';
import type { GuidanceSources } from '@runlith/agent/thread/transport/contract';
import { toolEntryId } from '@runlith/agent/transcript/entryNames';
import { GRANT_VARIABLE, SESSION_TOKEN_VARIABLE } from '../../platform/contract/service/credentials.js';
import { CurrentInvocation, Invocation } from '../../platform/cli/verb.js';
import { HOOK_OPERATIONS } from '../contract/wire/hooks.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import type { HarnessReportInput } from '../../threads/contract/wire/harness/observation.js';
import { hookReports } from '../testing/hookReports.js';
import type { TouchBrief } from '../../graph/contract/service/orientation.js';
import { hookConnectOver } from './door.js';
import { hookEventOf } from './dispatch.js';

type Reports = Effect.Success<ReturnType<typeof hookReports>>;
type Hook = Parameters<typeof hookEventOf>[0];

const post = Effect.fnUntraced(function* (world: Reports, input: HarnessReportInput) {
  yield* TestClock.adjust(1);
  return yield* world.reports.reported(world.id, { session: world.session, receipt: crypto.randomUUID(), ...input });
});

const invoke = Effect.fnUntraced(function* (
  world: Reports,
  command: Hook,
  payload: Record<string, unknown>,
  granted = true,
  named: HarnessName | null = null,
  stdin?: () => ReadableStream<Uint8Array>,
) {
  const before = (yield* TestConsole.logLines).length;
  const at = new Invocation(
    {
      [GRANT_VARIABLE]: granted ? 'fixture-grant' : undefined,
      [SESSION_TOKEN_VARIABLE]: granted ? world.session : undefined,
      TMPDIR: '/hook-reports',
    },
    '/project',
    stdin ?? (() => new Blob([JSON.stringify(payload)]).stream()),
    'hook',
  );
  const connect = hookConnectOver(() =>
    Effect.succeed({
      operations: {
        perform: (request) => {
          switch (request.params.id) {
            case 'report_harness_event':
              return Schema.decodeUnknownEffect(HOOK_OPERATIONS.report_harness_event.input)(request.payload).pipe(
                Effect.flatMap((input) => post(world, input)),
                Effect.map((receipt) => ({ status: 'reported', ...receipt })),
              );
            case 'guide_harness':
              return Schema.decodeUnknownEffect(HOOK_OPERATIONS.guide_harness.input)(request.payload).pipe(
                Effect.flatMap((input) =>
                  input.kind === 'prompt'
                    ? world.guidance.prompt(world.id, input.evidence, input.inputs)
                    : input.kind === 'seed'
                      ? world.guidance.seed(world.id, input.room)
                      : world.guidance.touch(world.id, input.evidence, input.briefs, input.places),
                ),
                Effect.map((guided) => ({ status: 'guided', ...guided })),
              );
            case 'session_start':
              return Effect.succeed({ status: 'ok', text: 'context payload' });
            case 'touch_path':
              return Effect.succeed({ status: 'ok', briefs: [], places: [] });
            default:
              return Effect.die(`The report hook reached ${request.params.id}.`);
          }
        },
      },
    }),
  );
  yield* hookEventOf(command, at, connect, named).pipe(
    Effect.provideService(CurrentInvocation, at),
    Effect.provide(MemoryFileSystem.layer),
  );
  return (yield* TestConsole.logLines).slice(before).map(String).join('\n');
});

it.effect('a resumed session binds its proven root once and refuses a second vendor root under the same process', () =>
  Effect.gen(function* () {
    const world = yield* hookReports({ name: 'devin', key: 'root' });
    yield* invoke(world, 'session-start', { hook_event_name: 'SessionStart', source: 'startup', session_id: 'root' });
    expect((yield* world.store.read(world.id))?.observation.binding).toMatchObject({ sessionId: world.session, rootKey: 'root' });
    const refused = yield* post(world, { occasion: 'session-start', event: { hook_event_name: 'SessionStart', session_id: 'foreign' } });
    expect(refused).toMatchObject({ outcome: 'refused', cause: 'foreign-root' });
    expect((yield* world.store.read(world.id))?.sessionKey).toBe('root');
  }),
);

it.effect('an unproven execution and a tool before root admission retain only stale metadata without binding a root', () =>
  Effect.gen(function* () {
    const unproven = yield* hookReports();
    yield* post(unproven, {
      session: undefined,
      occasion: 'session-start',
      event: { hook_event_name: 'SessionStart', session_id: 'unproven', model: 'reported-model' },
    });
    const first = yield* unproven.store.read(unproven.id);
    expect(first?.sessionKey).toBeNull();
    expect(first?.observation.binding.rootKey).toBeNull();
    expect(first?.observation.diagnostics.at(-1)).toMatchObject({ cause: 'execution-unproven' });
    const early = yield* hookReports();
    yield* invoke(early, 'post-tool-use', {
      hook_event_name: 'PostToolUse',
      session_id: 'early',
      tool_name: 'read',
      tool_input: { file_path: '/project/early.ts' },
      model: 'reported-model',
    });
    const second = yield* early.store.read(early.id);
    expect(second?.sessionKey).toBeNull();
    expect(second?.observation.diagnostics.map((row) => row.cause)).toContain('root-unproven');
    expect(second?.observation.metadata.model).toMatchObject({
      _tag: 'Stale',
      lastKnown: { value: 'reported-model', why: 'unproven-source' },
    });
  }),
);

it.effect('Cursor model evidence survives an event without a model, and Auto remains configured rather than serving', () =>
  Effect.gen(function* () {
    const world = yield* hookReports({ name: 'cursor', key: 'root' });
    yield* invoke(world, 'session-start', { hook_event_name: 'sessionStart', session_id: 'root' });
    yield* invoke(world, 'post-tool-use', {
      hook_event_name: 'postToolUse',
      session_id: 'root',
      tool_name: 'read',
      tool_input: { file_path: '/project/seen.ts' },
      model: 'claude-4.5-sonnet',
    });
    expect((yield* world.store.read(world.id))?.observation.metadata.model).toMatchObject({
      _tag: 'Value',
      value: 'claude-4.5-sonnet',
      claim: 'serving',
      source: 'hook',
    });
    yield* invoke(world, 'post-tool-use', {
      hook_event_name: 'postToolUse',
      session_id: 'root',
      tool_name: 'read',
      tool_input: { file_path: '/project/seen.ts' },
    });
    expect((yield* world.store.read(world.id))?.observation.metadata.model).toMatchObject({
      _tag: 'Value',
      value: 'claude-4.5-sonnet',
      claim: 'serving',
    });
    yield* invoke(world, 'post-tool-use', {
      hook_event_name: 'postToolUse',
      session_id: 'root',
      tool_name: 'read',
      tool_input: { file_path: '/project/seen.ts' },
      model: 'default',
    });
    expect((yield* world.store.read(world.id))?.observation.metadata.model).toMatchObject({
      _tag: 'Value',
      value: 'default',
      claim: 'configured',
    });
  }),
);

it.effect(
  'duplicate receipts precede stale-evidence judgement, while child attribution and future captures cannot replace current evidence',
  () =>
    Effect.gen(function* () {
      const world = yield* hookReports({ key: 'root' });
      yield* TestClock.adjust(100);
      const at = (ms: number) => new Date(ms).toISOString();
      const first: HarnessReportInput = {
        sessionKey: 'root',
        capturedAt: at(10),
        receipt: 'original',
        model: { read: 'value', value: 'sonnet', claim: 'configured' },
      };
      yield* post(world, first);
      const noOp = { ...first, capturedAt: at(20), receipt: 'no-op' };
      yield* post(world, noOp);
      yield* post(world, { ...first, capturedAt: at(30), receipt: 'new', model: { read: 'value', value: 'opus', claim: 'configured' } });
      expect(yield* post(world, noOp)).toMatchObject({ outcome: 'duplicate' });
      expect(yield* post(world, { ...first, capturedAt: at(25), receipt: 'delayed' })).toMatchObject({
        outcome: 'refused',
        cause: 'stale-evidence',
      });
      expect(
        yield* post(world, { event: { hook_event_name: 'UserPromptSubmit', session_id: 'root', agent_id: 'child', model: 'child-model' } }),
      ).toMatchObject({ outcome: 'refused', cause: 'child-event' });
      expect((yield* world.store.read(world.id))?.observation.metadata.model).toMatchObject({ _tag: 'Value', value: 'opus' });
      expect(yield* Effect.flip(post(world, { capturedAt: '2999-01-01T00:00:00.000Z' }))).toMatchObject({ code: 'observation-time' });
      const native = yield* world.storage.createThread({ ownerId: 'owner', scope: 'scope-a' });
      expect(yield* Effect.flip(world.reports.reported(native.id, { sessionKey: 'orphan' }))).toMatchObject({
        code: 'not-a-harness-thread',
      });
      expect(yield* world.store.read(native.id)).toBeNull();
    }),
);

it.effect('the five hook vocabularies open and finish real core runs without ending their CLI sessions or inventing a question', () =>
  Effect.gen(function* () {
    const base = yield* hookReports();
    const grokNames: Record<string, string> = {
      UserPromptSubmit: 'user_prompt_submit',
      PreToolUse: 'pre_tool_use',
      PostToolUse: 'post_tool_use',
      Stop: 'stop',
    };
    for (const name of ['claude-code', 'codex', 'grok', 'devin', 'cursor'] as const) {
      const world = { ...base, ...(yield* base.create(name, 'root')) };
      const turn =
        name === 'cursor'
          ? { generation_id: 'turn' }
          : name === 'codex'
            ? { turn_id: 'turn' }
            : name === 'devin'
              ? { prompt_id: 'turn' }
              : {};
      const event = (spelled: string, extra: Record<string, unknown> = {}) =>
        name === 'grok'
          ? { hookEventName: grokNames[spelled] ?? spelled, sessionId: 'root', ...turn, ...extra }
          : { hook_event_name: spelled, session_id: 'root', ...turn, ...extra };
      yield* invoke(world, 'observe', event(name === 'cursor' ? 'beforeSubmitPrompt' : 'UserPromptSubmit'));
      const run = yield* world.world.ledger.activeRun(world.id);
      expect(run?.status).toBe('running');
      const asking = name === 'codex' ? 'request_user_input' : name === 'claude-code' ? 'AskUserQuestion' : 'ask_user_question';
      yield* invoke(
        world,
        'pre-tool-use',
        event(name === 'cursor' ? 'preToolUse' : 'PreToolUse', name === 'grok' ? { toolName: asking } : { tool_name: asking }),
      );
      expect((yield* world.world.ledger.activeRun(world.id))?.id).toBe(run?.id);
      expect((yield* world.storage.aggregate.find(world.id))?.pendingInteraction).toBeNull();
      yield* invoke(
        world,
        'post-tool-use',
        event(name === 'cursor' ? 'postToolUse' : 'PostToolUse', name === 'grok' ? { toolName: 'read' } : { tool_name: 'read' }),
      );
      expect((yield* world.world.ledger.activeRun(world.id))?.id).toBe(run?.id);
      yield* invoke(world, 'stop', event(name === 'cursor' ? 'stop' : 'Stop', { stop_hook_active: true }));
      expect(yield* world.world.ledger.activeRun(world.id)).toBeNull();
      expect((yield* world.store.read(world.id))?.session?.state).toBe('running');
    }
  }),
);

it.effect(
  'Codex prompt notes replay to the same prompt and are recorded afresh for the next prompt, while unmeasured prompts stay silent',
  () =>
    Effect.gen(function* () {
      const note = 'operator data 7f3a';
      const unused = () => Effect.die('This prompt reads no orientation or recap.');
      const sources: GuidanceSources = {
        orientation: unused,
        law: unused,
        recap: unused,
        tail: () => Effect.succeed({ text: note, ruleId: 'operator-notes', state: {} }),
      };
      const world = yield* hookReports({ key: 'root', sources });
      const prompt = (turn: string) => ({ hook_event_name: 'UserPromptSubmit', session_id: 'root', turn_id: turn, prompt: 'hello' });
      const first = JSON.parse(yield* invoke(world, 'observe', prompt('one')));
      const again = JSON.parse(yield* invoke(world, 'observe', prompt('one')));
      const next = JSON.parse(yield* invoke(world, 'observe', prompt('two')));
      expect(first).toEqual({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: note } });
      expect(again).toEqual(first);
      expect(next).toEqual(first);
      const frames = yield* world.storage.eventLog.recordsAsOf(world.id, {
        head: yield* world.storage.eventLog.headPosition(world.id),
        afterPosition: 0,
        limit: 3,
        kinds: ['runtime-guidance'],
      });
      expect(frames).toHaveLength(2);
      const devin = { ...world, ...(yield* world.create('devin', 'quiet')) };
      expect(yield* invoke(devin, 'observe', { hook_event_name: 'UserPromptSubmit', session_id: 'quiet', prompt_id: 'one' })).toBe('');
      expect(yield* invoke(world, 'observe', prompt('ungranted'), false)).toBe('');
      expect(yield* world.notes.withheld(world.id)).toBeNull();
      const claude = yield* world.create('claude-code', 'claude');
      expect(yield* world.notes.withheld(claude.id)).toEqual(expect.any(String));
    }),
);

it.effect('an ungranted session-start still answers the named CLI envelope but cannot change its born facet', () =>
  Effect.gen(function* () {
    const world = yield* hookReports({ name: 'devin' });
    yield* world.store.change(world.id, (standing) => {
      const { session: _session, ...facet } = standing;
      return Effect.succeed({ facet, value: undefined });
    });
    const before = yield* world.store.read(world.id);
    const out = yield* invoke(world, 'session-start', { hook_event_name: 'SessionStart', session_id: 'root' }, false, 'codex');
    expect(JSON.parse(out)).toEqual({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'context payload' } });
    expect(yield* world.store.read(world.id)).toEqual(before);
  }),
);

it.effect('a Claude Code tool failure settles the call its pre-tool hook opened', () =>
  Effect.gen(function* () {
    const world = yield* hookReports({ name: 'claude-code', key: 'root' });
    yield* post(world, { event: { hook_event_name: 'UserPromptSubmit', session_id: 'root', prompt_id: 'turn' } });
    const call = { session_id: 'root', prompt_id: 'turn', tool_name: 'Bash', tool_use_id: 'call-failed', tool_input: { command: 'false' } };
    yield* TestClock.adjust(1);
    yield* invoke(world, 'pre-tool-use', { ...call, hook_event_name: 'PreToolUse' }, true, 'claude-code');
    expect(yield* world.storage.aggregate.entryById(world.id, toolEntryId('call-failed'))).toMatchObject({ toolState: 'input-available' });
    yield* TestClock.adjust(1);
    yield* invoke(world, 'observe', { ...call, hook_event_name: 'PostToolUseFailure', error: 'Exit code 1' }, true, 'claude-code');
    expect(yield* world.storage.aggregate.entryById(world.id, toolEntryId('call-failed'))).toMatchObject({ toolState: 'output-error' });
  }),
);

it.effect('empty hook evidence and an unterminated stdin do not post observations', () =>
  Effect.gen(function* () {
    const world = yield* hookReports({ name: 'devin', key: 'root' });
    const initial = yield* world.store.read(world.id);
    expect(yield* invoke(world, 'observe', { foreign: 'words' })).toBe('');
    const reading = yield* Deferred.make<void>();
    const hook = yield* Effect.forkChild(
      invoke(
        world,
        'observe',
        {},
        true,
        null,
        () =>
          new ReadableStream<Uint8Array>({
            pull() {
              Deferred.doneUnsafe(reading, Effect.void);
            },
          }),
      ),
    );
    yield* Deferred.await(reading);
    yield* TestClock.adjust(10_000);
    expect(yield* Fiber.join(hook)).toBe('');
    expect(yield* world.store.read(world.id)).toEqual(initial);
  }),
);

it.effect('a compact receipt resets delivered guidance once and a replay cannot reset the newly delivered law again', () =>
  Effect.gen(function* () {
    const world = yield* hookReports({ key: 'root' });
    const brief: TouchBrief = {
      place: '/project/source.ts',
      as: 'read',
      rules: [],
      tagPrompts: [],
      touches: [],
      explanations: [{ name: 'boundary', identity: 'boundary', revision: 'current', title: 'A boundary', body: 'data 7f3a' }],
    };
    expect((yield* world.guidance.touch(world.id, 'before', [brief], [])).text).not.toBeNull();
    const compact: HarnessReportInput = {
      receipt: 'compact-1',
      occasion: 'session-start',
      event: { hook_event_name: 'SessionStart', session_id: 'root', source: 'compact' },
    };
    expect(yield* post(world, compact)).toMatchObject({ outcome: 'admitted' });
    expect((yield* world.guidance.touch(world.id, 'after', [brief], [])).text).not.toBeNull();
    expect(yield* post(world, compact)).toMatchObject({ outcome: 'duplicate' });
    expect((yield* world.guidance.touch(world.id, 'after-replay', [brief], [])).text).toBeNull();
  }),
);
