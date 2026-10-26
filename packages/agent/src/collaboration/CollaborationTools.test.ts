import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Context, Effect, Layer, Schema } from 'effect';
import { readPartialJsonState } from '@runlith/utils/json';
import { OPERATOR_ONLY_REASONING, modelCatalog, type ModelOption } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { mintCursor, readCursor } from '@runlith/paging';
import { callerInThread, unthreadedCaller } from '../agent/testing/caller';
import { open } from '../agent/door/testing/open';
import {
  type Tool,
  ToolAnswer,
  type ToolCallDispatchOptions,
  toolDisplay,
  toolExecute,
  toolPartialDisplay,
  toolPrepare,
} from '../agent/tool';
import { NATIVE_BINDING, NATIVE_CAPABILITIES, type ThreadRecord } from '../thread/record';
import type { ThreadMetadataRow, ThreadRow } from '../thread/rows';
import { ThreadBudget, threadHostLayer } from '../thread/ThreadPorts';
import { type ThreadBorderFailed } from '../thread/ThreadBorder';
import { makeAgentRegistry } from '../thread/agents/AgentRegistry';
import type { ThreadAgent } from '../thread/agents/ThreadAgent';
import { threadAgentsLayer, threadStorageLayer } from '../thread/kernelPorts';
import { ThreadMemory } from '../thread/storage/memory/state';
import { makeMemoryRows } from '../thread/storage/memory/ThreadRows';
import { makeMemoryRuns } from '../thread/storage/memory/ThreadRuns';
import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '../thread/storage/runs';
import { makeMemoryEvents } from '../thread/storage/memory/ThreadEvents';
import { makeMemoryOwnerSettings } from '../thread/storage/memory/OwnerSettings';
import { inMemoryThreadTransitions } from '../thread/storage/memory/ThreadTransitions';
import { inMemoryInboxStorage } from '../thread/storage/InMemoryInboxStorage';
import type { MemoryTx } from '../thread/storage/memory/units';
import { emptyToolOutputs } from '../thread/conformance/runCycle/runDoubles';
import { ThreadBranch } from '../thread/run/ThreadBranch';
import { threadChangesLayer } from '../thread/run/ThreadChanges';
import { threadRunLedgerLayer } from '../thread/run/ThreadRunLedger';
import { ThreadStopping } from '../thread/run/ThreadStopping';
import { runAdmissionLayer } from '../thread/run/runAdmission';
import { RunScheduler, type RunInput, type RunSubject, type RunAdmitted } from '../thread/run/scheduler/RunScheduler';
import { threadModelsLayer } from '../thread/run/ThreadModels';
import { ThreadSnapshots } from '../thread/run/ThreadSnapshots';
import { ThreadRewind } from '../thread/run/ThreadRewind';
import { ThreadEntryKinds, makeThreadEntryReader } from '../transcript/kinds';
import type { Raised } from '../permissions/vocabulary';
import { collaborationTools } from './CollaborationTools';
import { type ThreadDirectoryAccess, type ThreadDirectoryEntry, ThreadDirectory } from './ThreadDirectory';
import type { ThreadActing, ThreadChildMoved, ThreadChildSpent, ThreadPlaneAccess } from './ThreadPlaneAccess';
import { ThreadModel } from './model';
import { ThreadRunConflict } from './runs';
import { nativeThreadModelLayer } from './native/model';
import { nativeThreadRunsLayer } from './native/runs';
import { nativeThreadsLayer } from './native/threads';
import { spawnSeatsLayer } from './collaborationResidency';
import { ContextCompaction } from './compaction';
import { DeclaredCollaboration } from './CollaborationConfig';
import { ThreadEnvelopes, type ThreadEnvelopeRecipient } from './ThreadEnvelopes';
import { RECIPIENT_CEILING, sendMessageInput } from './collaborationVerbs';
import { Threads, THREAD_LIST, type ThreadListQuery } from './threads';
import { ThreadTypes } from './types';
import { ThreadSpawnAccess } from './ThreadSpawnAccess';
import { ThreadPlanes, threadPlanesLayer } from './ThreadPlanes';
import { ThreadSpawnTree, threadSpawnTreeLayer } from './ThreadSpawnTree';
import { planeRefusalOf } from './planeRefusal';
import { NO_REVIEW, type Team } from './team';
const unused = () => Effect.die('This collaboration contract does not use this operation');
function unusedSync(): never {
  throw new Error('This collaboration contract does not use this synchronous operation');
}
const directory: ThreadDirectoryAccess = { list: () => Effect.succeed({ rows: [], total: 0, cursor: null }) };
const shipped = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);
const operatorOnlyRung = [...OPERATOR_ONLY_REASONING][0]!;
const operatorOnlyModel = shipped.options.find((option) => option.operatorOnly)!;
const inheritedModel = shipped.spawnInherits(operatorOnlyModel.provider, operatorOnlyModel.id);
const inheritedRung = inheritedModel.defaultReasoning!;
const operatorOnlyDefaultRung = operatorOnlyModel.defaultReasoning!;
const operatorOnlyFallbackRung = shipped.spawnReasoning(operatorOnlyModel, operatorOnlyRung, true)!;
const inheritedOperatorFallbackRung = shipped.spawnReasoning(inheritedModel, operatorOnlyRung, false)!;
const ordinaryOperatorRungModel = shipped.options.find(
  (option) => !option.operatorOnly && option.reasoningOptions.some((rung) => rung.id === operatorOnlyRung),
)!;
const ordinaryModel = shipped.options.find(
  (option) => !option.operatorOnly && option.provider !== operatorOnlyModel.provider && option.defaultReasoning,
)!;
const ordinaryRung = ordinaryModel.defaultReasoning!;
const startable = [{ id: 'coach', name: 'Coach', description: 'Speaking coach', baseAgentId: 'coach' }];
const reviewers = [{ id: 'reviewer', name: 'Reviewer', description: 'reads a diff', baseAgentId: 'reviewer' }];
type PlaneOver = Partial<ThreadPlaneAccess> & Partial<ThreadActing>;
function plane(input: PlaneOver = {}): ThreadPlaneAccess {
  const verbs: ThreadActing = {
    rewind: unused,
    worktreeAsking: Effect.succeed(null),
    approvals: { answer: unused },
    spawnLimits: () => Effect.succeed([]),
    spawnHome: unused,
    crossing: () => Effect.succeed([]),
    spawn: unused,
    stop: unused,
    continue: unused,
    move: unused,
    compact: unused,
    directory,
    messaging: {
      recipients: unused,
      settle: unused,
      lineage: () => Effect.succeed([]),
      aheadCrossing: () => Effect.succeed([]),
      send: unused,
    },
    ...input,
  };
  return {
    ownerId: 'owner-1',
    spawnDepth: { current: 0, maximum: 2, remaining: 2 },
    spawnSettlement: unused,
    startable: [],
    summarizerChoice: true,
    worktrees: null,
    parent: null,
    models: shipped,
    ...input,
    acting: () => Effect.succeed(verbs),
  };
}
const tools = (input: PlaneOver = {}) => collaborationTools(plane(input));
const execute = (source: Tool, input: unknown, call: ToolCallDispatchOptions) =>
  Effect.flatMap(toolExecute(source)!(input, call), (answer) =>
    answer instanceof ToolAnswer ? Effect.succeed(answer) : Effect.die('Expected a structured tool answer'),
  );
const call = (toolCallId: string, prepared?: unknown): ToolCallDispatchOptions => ({
  toolCallId,
  caller: unthreadedCaller,
  messages: [],
  prepared,
});
function modelWords(option: (typeof shipped.options)[number], rung: string): string {
  return `${option.label} · ${option.reasoningOptions.find((entry) => entry.id === rung)?.label ?? rung}`;
}

function titleAt(source: Tool, text: string): string | undefined {
  const state = readPartialJsonState(text);
  if (!state) throw new Error(`The partial input was unreadable: ${text}`);
  return toolPartialDisplay(source, state)?.title;
}
function streamedTitles(source: Tool, text: string): readonly (string | undefined)[] {
  const worn: (string | undefined)[] = [];
  for (let at = 1; at <= text.length; at += 1) {
    const state = readPartialJsonState(text.slice(0, at));
    const title = state ? toolPartialDisplay(source, state)?.title : undefined;
    if (worn.length === 0 || worn.at(-1) !== title) worn.push(title);
  }
  return worn;
}
describe('collaborationTools', () => {
  test('writing to and interrupting another agent need no capability: the address space is the server', () => {
    expect(Object.keys(tools()).sort()).toEqual(['answer_approval', 'interrupt_agent', 'list_agents', 'send_message', 'send_task']);
  });
  test('exposes child management tools only when the source can spawn targets', () => {
    expect(Object.keys(tools({ startable })).sort()).toEqual([
      'answer_approval',
      'compact_agent',
      'continue_agent',
      'interrupt_agent',
      'list_agents',
      'read_models',
      'rewind_agent',
      'send_message',
      'send_task',
      'set_agent_model',
      'spawn_agent',
      'stop_agent',
    ]);
  });
  it.effect(
    'compact_agent answers the completed compaction or preserves a typed running refusal',
    Effect.fnUntraced(function* () {
      const asked: {
        threadId: string;
        keep?: string;
        key?: string;
        asked?: readonly string[];
      }[] = [];
      const outcome = {
        threadId: 'thread-child',
        projectId: 7,
        status: 'completed' as const,
        runId: 'run-compaction',
        history: { before: 412, after: 9 },
        summarizer: {
          provider: 'opencode-go',
          model: 'deepseek-v4.1-flash',
          reasoning: null,
          account: 'key-1',
          own: false,
          reason: 'cold' as const,
        },
        skipped: [{ provider: 'muse', model: 'muse-spark-1.3', reason: 'quota' as const }],
      };
      const catalog = tools({
        startable,
        compact: (input) => {
          asked.push(input);
          return input.threadId === 'thread-working'
            ? Effect.fail(new ThreadRunConflict({ threadId: input.threadId, reason: 'running', running: null, key: null }))
            : Effect.succeed(outcome);
        },
      });
      const settled = yield* execute(
        catalog.compact_agent!,
        {
          threadId: 'thread-child',
          keep: 'the three files it edited and the spec it implements',
        },
        call('call-compact', []),
      );
      expect(asked).toEqual([
        { threadId: 'thread-child', keep: 'the three files it edited and the spec it implements', key: 'call-compact', asked: [] },
      ]);
      expect(settled.value).toEqual(outcome);
      expect(settled.display?.reference).toEqual({ kind: 'agent', address: 'thread-child', id: 'thread-child', projectId: 7 });
      expect(settled.display).toMatchObject({ form: 'message', text: 'the three files it edited and the spec it implements' });
      expect(settled.verdict).toEqual({ kind: 'answered' });
      const refused = yield* Effect.flip(execute(catalog.compact_agent!, { threadId: 'thread-working' }, call('call-busy', [])));
      expect(refused.code).toBe('thread-running');
      expect(refused.unblock?.length).toBeGreaterThan(0);
      expect(toolDisplay(catalog.compact_agent!, { threadId: 'thread-child' })).toEqual({
        form: 'none',
        title: 'thread-child',
        reference: { kind: 'agent', address: 'thread-child' },
      });
    }),
  );
  it.effect(
    'the directory answers a page and names the call that continues without losing agents',
    Effect.fnUntraced(function* () {
      const entries: ThreadDirectoryEntry[] = Array.from({ length: 21 }, (_, index) => ({
        threadId: `thread-${index}`,
        projectId: null,
        agentId: 'reviewer',
        name: null,
        spawnRootId: 'root-1',
        parentThreadId: null,
        selection: null,
        assignment: 'never-started',
        failureReason: null,
        failure: null,
        life: index === 20 ? 'working' : 'idle',
        askPrompt: null,
        context: null,
        warmth: null,
        movedAt: new Date(2026, 0, 1 + (index % 5)).toISOString(),
        stalledSince: null,
      }));
      entries.unshift(entries.pop()!);
      const catalog = tools({
        directory: {
          list: (query) => {
            const reading = query.cursor === undefined ? null : readCursor(query.cursor, THREAD_LIST);
            const start = reading !== null && 'at' in reading ? Number(reading.at[0]) : 0;
            const rows = entries.slice(start, start + query.limit);
            return Effect.succeed({
              rows,
              total: entries.length,
              cursor: start + rows.length < entries.length ? mintCursor(THREAD_LIST, [start + rows.length]) : null,
            });
          },
        },
      });
      const page = (input: { limit?: number; cursor?: string }) =>
        Effect.map(execute(catalog.list_agents!, input, call('call-list')), (answer) => String(answer.text).split('\n'));
      const first = yield* page({});
      expect(first).toHaveLength(21);
      expect(first[0]).toContain('thread-20');
      expect(first[0]).toContain('working');
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const lines = yield* page({ limit: 7, cursor });
        seen.push(...lines.slice(0, -1).map((line) => line.split(' · ')[0] ?? ''));
        cursor = /cursor="([\w-]+)"/.exec(lines.at(-1) ?? '')?.[1];
      } while (cursor !== undefined);
      expect(seen).toHaveLength(entries.length);
      expect(new Set(seen).size).toBe(entries.length);
      expect(seen[0]).toBe('thread-20');
    }),
  );
  it.effect(
    'the directory refuses a cursor it never minted',
    Effect.fnUntraced(function* () {
      const refused = yield* Effect.flip(execute(tools().list_agents!, { cursor: 'not-a-cursor' }, call('call-list')));
      expect(refused.reason).toStartWith('bad-cursor');
    }),
  );
  it.effect(
    'every verb aimed at another agent names its target as a subject',
    Effect.fnUntraced(function* () {
      const catalog = tools({ startable });
      const door = open().door;
      const subjects = (name: string, input: unknown) =>
        Effect.map(
          door.preflight({ name, tool: catalog[name]!, input, toolCallId: `call-subjects-${name}` }),
          (prepared) => prepared.subjects,
        );
      expect(yield* subjects('send_message', { to: ['researcher'], message: 'Read it.' })).toEqual([
        { kind: 'write', value: 'agent://owner-1/researcher' },
      ]);
      expect(yield* subjects('send_task', { to: ['thread-9', 'critic'], task: 'Read it.' })).toEqual([
        { kind: 'write', value: 'agent://owner-1/thread-9' },
        { kind: 'write', value: 'agent://owner-1/critic' },
      ]);
      expect(yield* subjects('stop_agent', { threadId: 'thread-9' })).toEqual([{ kind: 'write', value: 'agent://owner-1/thread-9' }]);
      expect(yield* subjects('list_agents', {})).toEqual([{ kind: 'read', value: 'agent://owner-1/*' }]);
      expect(yield* subjects('spawn_agent', { agentId: 'coach', task: 'Read it.' })).toEqual([
        { kind: 'write', value: 'spawn://owner-1/coach' },
      ]);
    }),
  );
  it.effect(
    'an act beyond reach declares its crossing consent and hands it to the verb',
    Effect.fnUntraced(function* () {
      const crossed: Raised = { condition: 'not-a-child', fact: 'thread thread-9 stands outside the calling thread`s subtree' };
      const handed: unknown[] = [];
      const catalog = tools({
        startable,
        crossing: ({ within }) => Effect.succeed(within === 'child' ? [crossed] : []),
        continue: (ask) => Effect.sync(() => (handed.push(ask), { threadId: ask.threadId, runId: 'run-9' })),
      });
      const prepared = yield* toolPrepare(catalog.continue_agent!)!(
        { threadId: 'thread-9' },
        { toolCallId: 'call-continue', caller: unthreadedCaller },
      );
      expect(prepared.raised?.map((one) => one.condition)).toEqual(['not-a-child']);
      yield* execute(catalog.continue_agent!, { threadId: 'thread-9' }, call('call-continue', prepared.prepared));
      expect(handed).toEqual([{ threadId: 'thread-9', key: 'call-continue', asked: ['not-a-child'] }]);
    }),
  );
  it.effect(
    'continue_agent preserves a running-child refusal with its recovery contract',
    Effect.fnUntraced(function* () {
      const catalog = tools({
        startable,
        continue: () => Effect.fail(new ThreadRunConflict({ threadId: 'thread-9', reason: 'running', running: null, key: null })),
      });
      const refused = yield* Effect.flip(execute(catalog.continue_agent!, { threadId: 'thread-9' }, call('continue', [])));
      expect(refused).toMatchObject({ _tag: 'Tool.Failed', code: 'thread-running' });
      expect(refused.reason.length).toBeGreaterThan(0);
      expect(refused.unblock?.length).toBeGreaterThan(0);
    }),
  );
  it.effect(
    'a new worktree declares consent only when the project asks for it',
    Effect.fnUntraced(function* () {
      const consents = (worktrees: ThreadPlaneAccess['worktrees'], input: unknown) =>
        Effect.map(
          toolPrepare(tools({ startable, worktrees }).spawn_agent!)!(input, { toolCallId: 'call-consent', caller: unthreadedCaller }),
          (prepared) => prepared.raised?.map((one) => one.condition) ?? [],
        );
      expect(yield* consents('ask', { agentId: 'coach', worktree: 'new' })).toEqual(['new-worktree']);
      expect(yield* consents('allow', { agentId: 'coach', worktree: 'new' })).toEqual([]);
      expect(yield* consents('ask', { agentId: 'coach', worktree: 'review-tree' })).toEqual([]);
    }),
  );
  test('spawn_agent names each enabled row of the sub-agent list in its model parameter, and no disabled one', () => {
    const row = { open: 5, depth: 5, taste: 5, ui: 5, spend: 3, only: [], not: [], note: null, operatorOnly: false, shipped: true };
    const team = {
      models: [
        { ...row, provider: ordinaryModel.provider, model: ordinaryModel.id, reasoning: ordinaryRung, on: true },
        { ...row, provider: inheritedModel.provider, model: inheritedModel.id, reasoning: inheritedRung, on: false },
      ],
      off: [],
      review: NO_REVIEW,
    };
    const described = (team?: Team) =>
      String(
        (tools({ startable, team }).spawn_agent!.inputSchema.properties as Record<string, { description?: string }>).model?.description,
      );
    expect(described(team)).toContain(`${ordinaryModel.provider}/${ordinaryModel.id} ${ordinaryRung}`);
    expect(described(team)).not.toContain(`${inheritedModel.provider}/${inheritedModel.id}`);
    expect(described(undefined)).not.toContain(ordinaryModel.id);
  });
  it.effect(
    'read_models answers the offered models by provider with their ladders',
    Effect.fnUntraced(function* () {
      const answer = yield* toolExecute(tools({ startable }).read_models!)!({}, call('call-models'));
      const first = shipped.modelsByCapability('text')[0]!;
      expect(String(answer)).toContain(`${first.provider}: `);
      expect(String(answer)).toContain(first.id);
    }),
  );
});
describe('what a plane verb shows a reader', () => {
  it.effect(
    'a spawn names the started address and carries the task and resolved model',
    Effect.fnUntraced(function* () {
      const catalog = tools({
        startable: reviewers,
        spawn: () =>
          Effect.succeed({
            status: 'started',
            threadId: 'thread-9',
            projectId: 7,
            agentId: 'reviewer',
            name: 'critic',
            model: { provider: inheritedModel.provider, model: inheritedModel.id, reasoning: inheritedOperatorFallbackRung },
            lowered: { model: operatorOnlyModel.id, reasoning: operatorOnlyRung },
          }),
      });
      const spawn = catalog.spawn_agent!;
      const input = { agentId: 'reviewer', task: 'Review the display contract' };
      expect(toolDisplay(spawn, { ...input, name: 'critic' })).toMatchObject({ title: 'critic', text: input.task });
      expect(
        toolDisplay(spawn, {
          ...input,
          name: 'critic',
          provider: ordinaryModel.provider,
          model: ordinaryModel.id,
          reasoning: ordinaryRung,
        }),
      ).toMatchObject({ title: 'critic', subtitle: `on ${modelWords(ordinaryModel, ordinaryRung)}` });
      expect(toolDisplay(spawn, input)?.title).toBe('reviewer');
      const settled = yield* execute(spawn, input, call('call-1', { raised: [] }));
      expect(settled.display).toMatchObject({
        form: 'message',
        title: 'critic',
        subtitle: `on ${modelWords(inheritedModel, inheritedOperatorFallbackRung)}`,
        reference: { kind: 'thread', id: 'thread-9', projectId: 7 },
      });
      expect(settled.display?.facts).toEqual([{ label: 'lowered from', value: modelWords(operatorOnlyModel, operatorOnlyRung) }]);
      expect(settled.display?.details?.map((fact) => fact.value)).toEqual([
        'reviewer',
        'thread-9',
        inheritedModel.provider,
        inheritedModel.id,
        inheritedOperatorFallbackRung,
        operatorOnlyModel.id,
        operatorOnlyRung,
      ]);
      expect(settled.value).toMatchObject({
        threadId: 'thread-9',
        model: { provider: inheritedModel.provider, model: inheritedModel.id, reasoning: inheritedOperatorFallbackRung },
        lowered: { model: operatorOnlyModel.id, reasoning: operatorOnlyRung },
      });
      const nameless = tools({
        startable: reviewers,
        spawn: () =>
          Effect.succeed({
            status: 'started',
            threadId: 'thread-10',
            agentId: 'reviewer',
            name: null,
            model: { provider: ordinaryModel.provider, model: ordinaryModel.id, reasoning: ordinaryRung },
          }),
      }).spawn_agent!;
      const anonymous = yield* execute(nameless, input, call('call-2', { raised: [] }));
      expect(anonymous.display).toMatchObject({ title: 'reviewer', reference: { kind: 'thread', id: 'thread-10' } });
    }),
  );
  test('a spawn projects its arrived subject before its task is complete', () => {
    const spawn = tools({ startable: reviewers }).spawn_agent!;
    const addressed = readPartialJsonState('{"agentId":"reviewer"');
    if (!addressed) throw new Error('The partial input was unreadable');
    expect(toolPartialDisplay(spawn, addressed)).toMatchObject({ form: 'none', title: 'reviewer' });
    expect(titleAt(spawn, '{"agentId":"reviewer","name":"crit')).toBe('reviewer');
    expect(
      titleAt(
        spawn,
        `{"agentId":"reviewer","name":"critic","provider":"${ordinaryModel.provider}","model":"${ordinaryModel.id}","reasoning":"${ordinaryRung}","task":"A long commission still`,
      ),
    ).toBe('critic');
  });
  test('a spawn without a model carries its subject while the task is streaming', () => {
    const spawn = tools({ startable: reviewers }).spawn_agent!;
    expect(streamedTitles(spawn, '{"agentId":"reviewer","name":"critic","task":"Read the display contract and report."}')).toEqual([
      undefined,
      'reviewer',
      'critic',
    ]);
    expect(titleAt(spawn, '{"agentId":"reviewer","name":"cri')).toBe('reviewer');
    expect(titleAt(spawn, '{"agentId":"reviewer","name":"critic","task":"Read the display con')).toBe('critic');
  });
  it.effect(
    'a send names its recipient and carries the handed words and delivery result',
    Effect.fnUntraced(function* () {
      const catalog = tools({
        messaging: {
          recipients: unused,
          settle: unused,
          lineage: unused,
          aheadCrossing: unused,
          send: () =>
            Effect.succeed({
              status: 'sent',
              deliveries: [
                {
                  envelopeId: 'envelope-1',
                  intent: 'task',
                  status: 'queued',
                  runId: 'run-7',
                  acted: true,
                  recipient: { threadId: 'thread-9', name: 'critic', sameTeam: true },
                },
              ],
            }),
        },
      });
      const task = 'Read the display contract\nand report what a row says.';
      expect(toolDisplay(catalog.send_task!, { to: ['critic'], task })).toMatchObject({
        form: 'message',
        title: 'critic',
        text: task,
        reference: { kind: 'agents', recipients: [{ address: 'critic' }] },
      });
      const settled = yield* execute(catalog.send_task!, { to: ['critic'], task }, call('call-send'));
      expect(settled.display).toMatchObject({
        form: 'message',
        title: 'critic',
        text: task,
        reference: { kind: 'agents', recipients: [{ address: 'critic', id: 'thread-9' }] },
        details: [
          { label: 'delivery', value: 'queued' },
          { label: 'envelope', value: 'envelope-1' },
        ],
      });
      expect(settled.display?.facts).toBeUndefined();
      expect(settled.value).toMatchObject({ status: 'sent', deliveries: [{ status: 'queued' }] });
    }),
  );
  test('recipients must be a nonempty list within the ceiling', () => {
    const decode = Schema.decodeUnknownResult(sendMessageInput);
    const many = (count: number) => Array.from({ length: count }, (_, index) => `agent-${index}`);
    expect(decode({ to: ['critic'], message: 'Read it.' })).toMatchObject({ _tag: 'Success', success: { to: ['critic'] } });
    expect(decode({ to: 'critic', message: 'Read it.' })._tag).toBe('Failure');
    const full = decode({ to: many(RECIPIENT_CEILING), message: 'Read it.' });
    expect(full).toMatchObject({ _tag: 'Success', success: { to: many(RECIPIENT_CEILING) } });
    expect(decode({ to: [], message: 'Read it.' })._tag).toBe('Failure');
    expect(decode({ to: many(RECIPIENT_CEILING + 1), message: 'Read it.' })._tag).toBe('Failure');
  });
  test('a streaming send carries every arrived addressee', () => {
    const state = readPartialJsonState('{"to":["critic"],"message":"Read the display con');
    const listed = readPartialJsonState('{"to":["critic","planner"],"message":"Read the display con');
    if (!state || !listed) throw new Error('The partial input was unreadable');
    expect(toolPartialDisplay(tools().send_message!, state)).toEqual({
      form: 'none',
      title: 'critic',
      reference: { kind: 'agents', recipients: [{ address: 'critic' }] },
    });
    expect(toolPartialDisplay(tools().send_message!, listed)?.reference).toEqual({
      kind: 'agents',
      recipients: [{ address: 'critic' }, { address: 'planner' }],
    });
    const message = 'Read the display contract.';
    const whole = readPartialJsonState(JSON.stringify({ to: ['critic'], message }).slice(0, -1));
    if (!whole) throw new Error('The partial input was unreadable');
    expect(toolPartialDisplay(tools().send_message!, whole)).toMatchObject({ form: 'message', text: message });
  });
  it.effect(
    'a settled send identifies resolved recipients and preserves delivery and team data',
    Effect.fnUntraced(function* () {
      const settle = (recipients: readonly ThreadEnvelopeRecipient[], to: readonly string[]) => {
        const catalog = tools({
          messaging: {
            recipients: unused,
            settle: unused,
            lineage: unused,
            aheadCrossing: unused,
            send: () =>
              Effect.succeed({
                status: 'sent',
                deliveries: recipients.map((recipient, position) => ({
                  envelopeId: `envelope-${position}`,
                  intent: 'message',
                  status: position === 0 ? 'delivered' : 'woken',
                  runId: 'run-7',
                  acted: true,
                  recipient,
                })),
              }),
          },
        });
        return execute(catalog.send_message!, { to, message: 'I need one disjoint edit.' }, call('call-send'));
      };
      const own = yield* settle([{ threadId: 'thread-9', name: 'critic', sameTeam: true }], ['critic']);
      expect(own.display?.reference).toEqual({ kind: 'agents', recipients: [{ address: 'critic', id: 'thread-9' }] });
      expect(own.value).toMatchObject({ deliveries: [{ status: 'delivered', recipient: { sameTeam: true } }] });
      const mixed = yield* settle(
        [
          { threadId: 'thread-9', name: 'fix-git', sameTeam: false },
          { threadId: 'thread-8', name: null, sameTeam: true },
          { threadId: 'thread-7', name: 'critic', sameTeam: true },
        ],
        ['thread-9', 'thread-8', 'critic'],
      );
      expect(mixed.display?.reference).toEqual({
        kind: 'agents',
        recipients: [
          { address: 'fix-git', id: 'thread-9' },
          { address: 'thread-8', id: 'thread-8' },
          { address: 'critic', id: 'thread-7' },
        ],
      });
      expect(mixed.value).toMatchObject({
        deliveries: [
          { status: 'delivered', recipient: { sameTeam: false } },
          { status: 'woken', recipient: { sameTeam: true } },
          { status: 'woken', recipient: { sameTeam: true } },
        ],
      });
    }),
  );
  it.effect(
    'a send answers the model its envelope as text, and the same document the operation answers on json',
    Effect.fnUntraced(function* () {
      const catalog = tools({
        messaging: {
          recipients: unused,
          settle: unused,
          lineage: unused,
          aheadCrossing: unused,
          send: () =>
            Effect.succeed({
              status: 'sent',
              deliveries: [
                {
                  envelopeId: 'envelope-41',
                  intent: 'message',
                  status: 'woken',
                  runId: 'run-7',
                  acted: true,
                  recipient: { threadId: 'thread-9', name: 'critic', sameTeam: true },
                },
              ],
            }),
        },
      });
      expect(catalog.send_message!.doorFields).toContain('json');
      const input = { to: ['critic'], message: 'Read the schema again.' };
      const spoken = yield* execute(catalog.send_message!, input, call('call-text'));
      expect(spoken.text).toContain('envelope-41');
      expect(spoken.text).toContain('thread-9');
      const document = yield* execute(catalog.send_message!, input, { ...call('call-json'), json: true });
      expect(document.text).toBeUndefined();
      expect(document.value).toEqual(spoken.value);
    }),
  );
  it.effect(
    'a multi-agent call asks once for all subjects and adds the ancestor crossing',
    Effect.fnUntraced(function* () {
      const ancestor: ThreadRecord = {
        id: 'thread-lead',
        projectId: undefined,
        typeId: null,
        spawnedByRunId: null,
        bornOf: null,
        createdBy: null,
        host: null,
        authority: { mode: 'trust', bypassFrom: null },
        plain: false,
        budgetTokens: null,
        model: null,
        profile: null,
        agentId: 'tagma',
        principal: 'owner-1',
        parentThreadId: null,
        spawnRootId: 'root',
        name: 'lead',
        harness: 'native',
        capabilities: NATIVE_CAPABILITIES,
      };
      const catalog = tools({
        messaging: {
          recipients: unused,
          settle: unused,
          lineage: (to) => Effect.succeed(to.includes('lead') ? [{ thread: ancestor, lineage: 'ancestor' as const }] : []),
          aheadCrossing: () => Effect.succeed([]),
          send: unused,
        },
      });
      const ask = (name: string, input: unknown) =>
        open({ mode: 'review' }).door.preflight({ name, tool: catalog[name]!, input, toolCallId: `call-${name}` });
      const message = yield* ask('send_message', { to: ['critic', 'planner', 'fixer'], message: 'Read the schema again.' });
      expect(message.permission.verdict).toBe('ask');
      expect(message.subjects.map((subject) => subject.value)).toEqual([
        'agent://owner-1/critic',
        'agent://owner-1/planner',
        'agent://owner-1/fixer',
      ]);
      expect(message.confirmation?.facts?.map((fact) => fact.value)).toContain('critic, planner, fixer');
      const interrupt = yield* ask('interrupt_agent', { to: ['critic', 'lead'], reason: 'Stop: the brief changed.' });
      expect(interrupt.permission.verdict).toBe('ask');
      expect(interrupt.permission.verdict === 'ask' && interrupt.permission.reasons.map((reason) => reason.id)).toContain('own-lineage');
      const single = yield* ask('send_message', { to: ['critic'], message: 'Read the schema again.' });
      expect(single.subjects.map((subject) => subject.value)).toEqual(['agent://owner-1/critic']);
    }),
  );
  it.effect(
    'a compaction for two children refuses before sending anything',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld();
      const parent = spawnParent(ordinaryModel, ordinaryRung);
      yield* world.seed(parent);
      const access = yield* world.acting(parent, 'run-parent');
      const first = yield* access.spawn({ requestId: 'first', agentId: 'tagma', task: 'Work' });
      const second = yield* access.spawn({ requestId: 'second', agentId: 'tagma', task: 'Work' });
      expect(
        yield* access.messaging.send({ to: [first.threadId, second.threadId], intent: 'task', text: 'Read it.', key: 'both', compact: {} }),
      ).toEqual({ status: 'refused', code: 'compact-to-many' });
      expect(world.interrupted).toEqual([]);
    }),
  );
  test('each mutating verb declares its change', () => {
    const changes = Object.entries(tools({ startable: reviewers }))
      .filter(([, tool]) => tool.mutates === true)
      .map(([name]) => name)
      .sort();
    expect(changes).toEqual([
      'answer_approval',
      'compact_agent',
      'continue_agent',
      'interrupt_agent',
      'rewind_agent',
      'send_message',
      'send_task',
      'set_agent_model',
      'spawn_agent',
      'stop_agent',
    ]);
  });
  it.effect(
    'an unresolved address returns addressable names and a refusal with recovery',
    Effect.fnUntraced(function* () {
      const catalog = tools({
        messaging: {
          recipients: unused,
          settle: unused,
          lineage: unused,
          aheadCrossing: unused,
          send: () => Effect.succeed({ status: 'not-found', addresses: ['reviewer'], addressable: ['critic', 'planner'] }),
        },
      });
      for (const [name, input] of [
        ['send_message', { to: ['reviewer'], message: 'read this' }],
        ['send_task', { to: ['reviewer', 'critic'], task: 'read this' }],
      ] as const) {
        const answer = yield* execute(catalog[name]!, input, call(`call-${name}`));
        expect(answer.value).toMatchObject({
          status: 'not-found',
          addresses: ['reviewer'],
          addressable: ['critic', 'planner'],
          unblock: expect.arrayContaining([expect.any(String)]),
        });
        expect(answer.verdict).toMatchObject({ kind: 'refused', refusal: { code: 'not-found' } });
      }
    }),
  );
});
function spawnParent(option: ModelOption, reasoning: string): ThreadRow {
  const now = new Date('2026-09-01T00:00:00.000Z');
  const id = `parent-${option.id}-${reasoning}`;
  return {
    id,
    ownerId: 'owner',
    agentId: 'tagma',
    parentThreadId: null,
    spawnedByRunId: null,
    bornOf: null,
    spawnRootId: id,
    cacheGroup: id,
    name: null,
    budgetTokens: null,
    profile: null,
    authority: { mode: 'trust', bypassFrom: null },
    plain: false,
    hostKind: null,
    hostId: null,
    bindings: {},
    pendingInteraction: null,
    account: null,
    provider: option.provider,
    model: option.id,
    reasoning,
    switches: {},
    transport: NATIVE_BINDING,
    capabilities: NATIVE_CAPABILITIES,
    systemPrompt: null,
    pendingSystemPrompt: null,
    status: 'idle',
    failureReason: null,
    contextReading: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}
const spawnWorld = Effect.fnUntraced(function* (menu?: typeof shipped) {
  const memory = new ThreadMemory(makeThreadEntryReader({ products: [] }));
  const rows = makeMemoryRows({ memory });
  const inbox = inMemoryInboxStorage({ units: memory.units, calls: memory.records });
  const runStore = makeMemoryRuns({ memory, ownerId: 'test-owner', scope: null });
  const moved: string[] = [];
  const interrupted: string[] = [];
  const storage = threadStorageLayer({
    storage: rows,
    eventLog: makeMemoryEvents({ memory }),
    transitions: inMemoryThreadTransitions({ memory }),
    createRuns: (owner) => makeMemoryRuns({ memory, ownerId: owner, scope: null }),
    inbox,
    ownerSettings: makeMemoryOwnerSettings({ memory }),
    attachments: { keep: unused, hydrate: unused, resolve: unused, addressed: unused, sizes: unused },
    toolOutputs: { scope: () => ({ ...emptyToolOutputs, commitReferenced: unused }), settleOpen: unused },
  });
  const agents = yield* makeAgentRegistry<MemoryTx>();
  const agent: ThreadAgent<MemoryTx> = {
    id: 'tagma',
    name: 'Fixture agent',
    description: '',
    runPolicy: { userStartable: false, backgroundStartable: false },
    grant: { sources: [{ source: 'collaboration', narrowable: true }] },
    prepare: unused,
    instructions: unused,
    toolCatalog: unused,
    toolDoor: unused,
  };
  yield* agents.hold(agent, 'collaboration-tools-tests');
  function admit<I extends RunInput>(thread: RunSubject<I>, input: I): Effect.Effect<RunAdmitted[I['kind']], ThreadBorderFailed>;
  function admit(thread: ThreadMetadataRow, input: RunInput): Effect.Effect<RunAdmitted[RunInput['kind']], ThreadBorderFailed> {
    return Effect.suspend(() => {
      if (input.kind !== 'begin' && input.kind !== 'continue') return unused();
      return Effect.gen(function* () {
        const opened = yield* runStore.createRun({
          startFrom: thread,
          kind: 'turn',
          approval: { mode: 'trust', interactive: false },
          progress: { stage: 'running', message: null },
          startKey: input.kind === 'begin' ? input.start?.startKey : input.startKey,
          runId: input.kind === 'continue' ? 'resumed-run' : `run-${thread.id}`,
        });
        if (input.kind === 'begin' && input.start) yield* inbox.deliver([input.start.itemId], opened.run.id);
        return { runId: opened.run.id, acted: opened._tag === 'Started' };
      });
    });
  }
  const given = Layer.mergeAll(
    storage,
    threadAgentsLayer(agents),
    threadChangesLayer,
    runAdmissionLayer,
    threadHostLayer<MemoryTx>({
      ownerId: 'test-owner',
      rhythms: {
        lease: { heartbeatIntervalMs: 100, staleRunningAfterMs: 500, takeoverAfterMs: 1000 },
        reaper: { staleSweepIntervalMs: 100, recoveryBatch: 1, resumeWithinMs: 100, resumeAttemptLimit: 1 },
        settlement: { settledClaimAfterMs: 100, settledHeartbeatIntervalMs: 10, settledNotificationBatch: 1, settledNotifyAttemptLimit: 1 },
        streamFlushIntervalMs: 10,
      },
      modelMoves: { moved: (thread) => Effect.sync(() => void moved.push(thread.id)) },
    }),
    Layer.succeed(
      DeclaredCollaboration,
      DeclaredCollaboration.of({
        models: () => shipped,
        ...(menu === undefined ? {} : { menu: () => menu }),
        subAgentDepth: () => Effect.succeed(2),
        delegation: () => Effect.succeed({ allowed: true, setAt: null }),
        reconcileIntervalMs: 30000,
      }),
    ),
    Layer.succeed(
      ThreadDirectory,
      ThreadDirectory.of({ access: () => ({ list: () => Effect.succeed({ rows: [], total: 0, cursor: null }) }), warmth: unused }),
    ),
    Layer.succeed(
      ThreadTypes,
      ThreadTypes.of({
        resolve: () => Effect.succeed({ baseAgentId: 'tagma', harness: 'native', capabilities: NATIVE_CAPABILITIES }),
        offered: () => Effect.succeed([]),
      }),
    ),
    Layer.succeed(
      ContextCompaction,
      ContextCompaction.of({ choosesSummarizer: false, summarizer: unused, compact: unused, compactAhead: unused }),
    ),
    Layer.succeed(ThreadBranch, ThreadBranch.of({ fork: unused })),
    Layer.succeed(ThreadRewind, ThreadRewind.of({ rewind: unused, restore: unused, preview: unused, points: unused, draft: unused })),
    Layer.succeed(
      ThreadBudget,
      ThreadBudget.of({ of: () => Effect.succeed({ allowed: null, spent: 0, remaining: null, unmeasuredCount: 0, unmeasuredSample: [] }) }),
    ),
    Layer.succeed(ThreadSpawnAccess, ThreadSpawnAccess.of({ depth: () => Effect.succeed({ current: 0, maximum: 2, remaining: 2 }) })),
    Layer.succeed(
      ThreadSnapshots,
      ThreadSnapshots.of({
        publish: () => Effect.void,
        state: unused,
        snapshot: unused,
        attachFrom: unused,
        page: unused,
        statuses: unused,
        forget: unused,
      }),
    ),
    Layer.succeed(
      RunScheduler,
      RunScheduler.of({ admit, resume: unused, adopt: unused, withdraw: unused, queued: unused, launchBlocked: unusedSync }),
    ),
    Layer.succeed(ThreadStopping, ThreadStopping.of({ stop: unused, byReader: unused, release: unused })),
  );
  const pinned = Layer.effect(
    Threads,
    Effect.map(Threads, (native) =>
      Threads.of({
        ...native,
        find: (threadId, principal) =>
          Effect.map(native.find(threadId, principal), (found) =>
            found !== null && found.agentId === 'harness'
              ? { ...found, capabilities: { ...found.capabilities, modelMove: 'pinned' as const } }
              : found,
          ),
      }),
    ),
  ).pipe(Layer.provide(nativeThreadsLayer));
  const envelopes = Layer.effect(
    ThreadEnvelopes,
    Effect.gen(function* () {
      const threads = yield* Threads;
      return ThreadEnvelopes.of({
        deliver: unused,
        completeRun: unused,
        withdrawRequest: unused,
        access: (sender) => ({
          recipients: Effect.fnUntraced(function* (to) {
            const addresses = [...new Set(to)];
            const found = yield* Effect.forEach(addresses, (id) => threads.find(id, sender.principal));
            const missing = addresses.filter((_id, index) => found[index] === null);
            return missing.length > 0
              ? { status: 'not-found' as const, addresses: missing, addressable: [] }
              : { holder: null, recipients: found.filter((record) => record !== null) };
          }),
          send: (input) =>
            Effect.sync(() => {
              interrupted.push(...input.to);
              return { status: 'sent' as const, deliveries: [] };
            }),
          sendAhead: unused,
          settle: unused,
          waitFor: unused,
          collect: unused,
        }),
      });
    }),
  );
  const context = yield* Layer.build(
    threadPlanesLayer.pipe(
      Layer.provideMerge(threadSpawnTreeLayer),
      Layer.provideMerge(Layer.mergeAll(nativeThreadModelLayer, envelopes)),
      Layer.provideMerge(Layer.mergeAll(pinned, nativeThreadRunsLayer, spawnSeatsLayer, threadModelsLayer)),
      Layer.provideMerge(threadRunLedgerLayer),
      Layer.provideMerge(given),
      Layer.provideMerge(ThreadEntryKinds.layer([])),
    ),
  );
  const threads = Context.get(context, Threads);
  const planes = Context.get(context, ThreadPlanes);
  const record = (row: ThreadMetadataRow) =>
    Effect.flatMap(threads.find(row.id, row.ownerId), (found) =>
      found === null ? Effect.die(`No record of ${row.id}`) : Effect.succeed(found),
    );
  const acting = Effect.fnUntraced(function* (row: ThreadMetadataRow, runId: string) {
    const access = yield* planes.access(yield* record(row));
    if (!access) return yield* Effect.die('The collaboration plane was not mounted');
    return yield* access.acting(callerInThread(row.id, runId));
  });
  const seed = Effect.fnUntraced(function* (row: ThreadRow) {
    const parentId = row.parentThreadId;
    yield* parentId === null ? rows.insert(row) : rows.transaction((tx) => rows.insertChild(parentId, row, tx));
    const held = memory.held(row.id);
    if (!held) return yield* Effect.die(`No row of ${row.id}`);
    held.row = row;
  });
  return {
    memory,
    rows,
    runStore,
    moved,
    interrupted,
    seed,
    acting,
    record,
    tree: Context.get(context, ThreadSpawnTree),
    threads,
    models: Context.get(context, ThreadModel),
    row: (id: string) => memory.held(id)?.row,
  };
});
const movedOf = (answer: ThreadChildMoved | ThreadChildSpent) =>
  'status' in answer ? Effect.die('The move was answered as spent') : Effect.succeed(answer);
function childOf(parent: ThreadRow, id: string, option: ModelOption, reasoning: string, over: Partial<ThreadRow> = {}): ThreadRow {
  return { ...spawnParent(option, reasoning), id, parentThreadId: parent.id, spawnRootId: parent.spawnRootId, ...over };
}
const movePlane = Effect.fnUntraced(function* (parent: ThreadRow) {
  const world = yield* spawnWorld();
  yield* world.seed(parent);
  return { ...world, access: yield* world.acting(parent, 'parent-run') };
});
it.effect(
  'native directory pages cross activity groups and equal movement times without losing rows',
  Effect.fnUntraced(function* () {
    const world = yield* spawnWorld();
    const parent = spawnParent(ordinaryModel, ordinaryRung);
    for (const [index, life] of ['idle', 'awaiting', 'working', 'working'].entries()) {
      const row = { ...parent, id: String(index) };
      yield* world.seed(row);
      const opened = yield* world.runStore.createRun({
        startFrom: row,
        kind: 'turn',
        approval: { mode: 'trust', interactive: false },
        progress: { stage: life === 'awaiting' ? THREAD_RUN_AWAITING_QUESTION_STAGE : null, message: null },
        runId: `run-${row.id}`,
      });
      if (life === 'idle')
        yield* world.runStore.settleRun(opened.run.id, {
          status: 'completed',
          progress: { stage: null, message: null },
          finishedAt: parent.createdAt,
          heartbeatAt: parent.createdAt,
        });
      const held = world.memory.held(row.id)!;
      held.row = { ...held.row, updatedAt: parent.updatedAt };
    }
    const query: ThreadListQuery = { from: '0', principal: parent.ownerId, limit: 2 };
    const first = yield* world.threads.list(query);
    const second = yield* world.threads.list({ ...query, cursor: first.cursor! });
    expect(first.total).toBe(4);
    expect(second.total).toBe(4);
    expect([...first.rows, ...second.rows].map((row) => [row.threadId, row.run?.life ?? 'idle'])).toEqual([
      ['3', 'working'],
      ['2', 'working'],
      ['1', 'awaiting'],
      ['0', 'idle'],
    ]);
    expect(second.cursor).toBeNull();
  }),
);
it.effect(
  'a reasoning-only spawn inherits its parent model and applies the named rung',
  Effect.fnUntraced(function* () {
    const option = shipped.options.find(
      (model) =>
        !model.operatorOnly &&
        model.defaultReasoning !== null &&
        model.id !== shipped.defaultTextModelId(model.provider) &&
        model.reasoningOptions.some((rung) => rung.id !== model.defaultReasoning && !OPERATOR_ONLY_REASONING.has(rung.id)),
    )!;
    const reasoning = option.reasoningOptions.find(
      (rung) => rung.id !== option.defaultReasoning && !OPERATOR_ONLY_REASONING.has(rung.id),
    )!.id;
    const world = yield* movePlane(spawnParent(option, option.defaultReasoning!));
    const child = yield* world.access.spawn({
      requestId: 'reasoning-only',
      agentId: 'tagma',
      task: 'Work at the named reasoning rung',
      model: { reasoning },
    });
    const expected = { provider: option.provider, model: option.id, reasoning };
    expect(world.row(child.threadId)).toMatchObject(expected);
    expect(child.model).toEqual(expected);
  }),
);

it.effect(
  'spawnChild lowers operator-only parent values and preserves ordinary inheritance',
  Effect.fnUntraced(function* () {
    const world = yield* spawnWorld();
    let request = 0;
    const spawn = Effect.fnUntraced(function* (source: ThreadRow) {
      yield* world.seed(source);
      const result = yield* world.tree.spawn({
        parent: yield* world.record(source),
        requestId: `request-${++request}`,
        agentId: 'tagma',
        task: 'Inspect the spawn selection',
        name: `child-${request}`,
      });
      return { result, row: world.row(result.threadId) };
    });
    const inheritedOperatorModel = yield* spawn(spawnParent(operatorOnlyModel, operatorOnlyDefaultRung));
    expect(inheritedOperatorModel.row).toMatchObject({
      provider: inheritedModel.provider,
      model: inheritedModel.id,
      reasoning: operatorOnlyDefaultRung,
    });
    expect(inheritedOperatorModel.result).toMatchObject({
      model: { provider: inheritedModel.provider, model: inheritedModel.id, reasoning: operatorOnlyDefaultRung },
      lowered: { model: operatorOnlyModel.id },
    });
    const inheritedBoth = yield* spawn(spawnParent(operatorOnlyModel, operatorOnlyRung));
    expect(inheritedBoth.row).toMatchObject({
      provider: inheritedModel.provider,
      model: inheritedModel.id,
      reasoning: inheritedOperatorFallbackRung,
    });
    expect(inheritedBoth.result.lowered).toEqual({ model: operatorOnlyModel.id, reasoning: operatorOnlyRung });
    const inheritedRungOnly = yield* spawn(spawnParent(inheritedModel, operatorOnlyRung));
    expect(inheritedRungOnly.row).toMatchObject({
      provider: inheritedModel.provider,
      model: inheritedModel.id,
      reasoning: inheritedOperatorFallbackRung,
    });
    expect(inheritedRungOnly.result.lowered).toEqual({ reasoning: operatorOnlyRung });
    const unchanged = yield* spawn(spawnParent(ordinaryModel, ordinaryRung));
    expect(unchanged.row).toMatchObject({ provider: ordinaryModel.provider, model: ordinaryModel.id, reasoning: ordinaryRung });
    expect(unchanged.result.lowered).toBeUndefined();
  }),
);
it.effect(
  'spawnChild keeps a named operator-only model while projecting its named rung',
  Effect.fnUntraced(function* () {
    const source = spawnParent(inheritedModel, inheritedRung);
    const world = yield* movePlane(source);
    const operatorOnly = yield* world.access.spawn({
      requestId: 'explicit-operator-only',
      agentId: 'tagma',
      task: 'Inspect the explicit selection',
      model: { provider: operatorOnlyModel.provider, model: operatorOnlyModel.id, reasoning: operatorOnlyRung },
    });
    expect(world.row(operatorOnly.threadId)).toMatchObject({ model: operatorOnlyModel.id, reasoning: operatorOnlyFallbackRung });
    expect(operatorOnly).toMatchObject({
      model: { provider: operatorOnlyModel.provider, model: operatorOnlyModel.id, reasoning: operatorOnlyFallbackRung },
      lowered: { reasoning: operatorOnlyRung },
    });
    const ordinary = yield* world.access.spawn({
      requestId: 'explicit-ordinary',
      agentId: 'tagma',
      task: 'Inspect the explicit selection',
      model: { provider: ordinaryOperatorRungModel.provider, model: ordinaryOperatorRungModel.id, reasoning: operatorOnlyRung },
    });
    expect(world.row(ordinary.threadId)).toMatchObject({ model: ordinaryOperatorRungModel.id, reasoning: operatorOnlyRung });
    expect(ordinary.model).toEqual({
      provider: ordinaryOperatorRungModel.provider,
      model: ordinaryOperatorRungModel.id,
      reasoning: operatorOnlyRung,
    });
    expect(ordinary.lowered).toBeUndefined();
  }),
);
it.effect(
  'a parent moves a child by name or id, preserves unnamed values and drops unsupported provider state',
  Effect.fnUntraced(function* () {
    const parent = spawnParent(ordinaryModel, ordinaryRung);
    const world = yield* movePlane(parent);
    yield* world.seed(
      childOf(parent, 'child-crossing', ordinaryModel, ordinaryRung, {
        name: 'worker',
        projectId: 7,
        account: 'work',
        switches: { 'not-declared': 'on' },
      }),
    );
    const ask = { threadId: 'worker', model: { provider: operatorOnlyModel.provider }, key: 'call-1' };
    const crossing = yield* Effect.flatMap(world.access.move(ask), movedOf);
    const declaredDefault = shipped.defaultTextModelId(operatorOnlyModel.provider);
    const landed = shipped.spawnInherits(operatorOnlyModel.provider, declaredDefault);
    const carried = shipped.spawnReasoning(landed, ordinaryRung, false);
    expect(world.row('child-crossing')).toMatchObject({
      provider: landed.provider,
      model: landed.id,
      reasoning: carried,
      account: null,
      switches: {},
    });
    expect(crossing.from).toEqual({ provider: ordinaryModel.provider, model: ordinaryModel.id, reasoning: ordinaryRung });
    expect(crossing.projectId).toBe(7);
    expect(crossing.to).toEqual({ provider: landed.provider, model: landed.id, reasoning: carried });
    expect(crossing.lowered?.model).toBe(declaredDefault === landed.id ? undefined : declaredDefault);
    expect(world.moved).toEqual(['child-crossing']);
    const replayed = yield* Effect.flatMap(world.access.move(ask), movedOf);
    expect(replayed.to).toEqual(crossing.to);
    expect(replayed.projectId).toBe(7);
    expect(world.moved).toEqual(['child-crossing']);
    yield* world.seed(childOf(parent, 'child-staying', ordinaryModel, ordinaryRung, { account: 'work' }));
    const rung = ordinaryModel.reasoningOptions.find((level) => level.id !== ordinaryRung)!.id;
    yield* world.access.move({ threadId: 'child-staying', model: { reasoning: rung }, key: 'call-2' });
    expect(world.row('child-staying')).toMatchObject({
      provider: ordinaryModel.provider,
      model: ordinaryModel.id,
      reasoning: rung,
      account: 'work',
    });
    yield* world.seed(childOf(parent, 'child-at-max', ordinaryOperatorRungModel, operatorOnlyRung));
    const lowered = yield* Effect.flatMap(
      world.access.move({ threadId: 'child-at-max', model: { model: ordinaryOperatorRungModel.id }, key: 'call-3' }),
      movedOf,
    );
    expect(world.row('child-at-max')?.reasoning).toBe(shipped.spawnReasoning(ordinaryOperatorRungModel, operatorOnlyRung, false));
    expect(lowered.lowered).toEqual({ reasoning: operatorOnlyRung });
  }),
);
it.effect(
  'an adapted model move replays without acting again and refuses a different selection under the same key',
  Effect.fnUntraced(function* () {
    const parent = spawnParent(ordinaryModel, ordinaryRung);
    const world = yield* movePlane(parent);
    yield* world.seed(childOf(parent, 'child-adapted', ordinaryModel, ordinaryRung));
    const [first, second] = shipped.options.filter((option) => !option.operatorOnly);
    const deadline = new Date((yield* Clock.currentTimeMillis) + 60000);
    const move = (key: string, option: ModelOption) =>
      world.models.adapted(
        'child-adapted',
        { request: { key, deadline }, option, reasoning: null },
        Effect.as(world.rows.update('child-adapted', { provider: option.provider, model: option.id }), {
          from: null,
          to: { provider: option.provider, model: option.id, reasoning: null },
        }),
      );
    expect(yield* move('K', first!)).toMatchObject({ status: 'moved', acted: true, to: { model: first!.id } });
    expect(yield* move('K2', second!)).toMatchObject({ status: 'moved', acted: true, to: { model: second!.id } });
    expect(yield* move('K', first!)).toMatchObject({ status: 'moved', acted: false, to: { model: first!.id } });
    expect(world.row('child-adapted')?.model).toBe(second!.id);
    const reused = yield* Effect.flip(move('K', second!));
    expect(reused).toMatchObject({ _tag: 'ThreadModelConflict', reason: 'act-id-reused' });
    expect(world.row('child-adapted')?.model).toBe(second!.id);
  }),
);
it.effect(
  'a replay after a model stop records the model and resumes saved work exactly once',
  Effect.fnUntraced(function* () {
    const parent = spawnParent(ordinaryModel, ordinaryRung);
    const world = yield* movePlane(parent);
    const childId = 'child-recovering';
    const child = childOf(parent, childId, ordinaryModel, ordinaryRung);
    yield* world.seed(child);
    const key = 'interrupted-move';
    yield* world.runStore.createRun({
      startFrom: child,
      kind: 'turn',
      approval: { mode: 'trust', interactive: false },
      progress: { stage: 'running', message: null },
      runId: 'paused-run',
    });
    const at = new Date(yield* Clock.currentTimeMillis);
    yield* world.runStore.stopRun('paused-run', {
      intent: { by: 'model', key, marker: false, withdraw: false },
      progress: { stage: null, message: null },
      finishedAt: at,
      heartbeatAt: at,
    });
    const asked = { threadId: childId, key, model: { provider: inheritedModel.provider, model: inheritedModel.id } };
    expect(yield* world.access.move(asked)).toMatchObject({ runId: 'resumed-run' });
    expect(yield* world.access.move(asked)).toMatchObject({ runId: 'resumed-run' });
    expect((yield* world.runStore.latestRun(childId))?.id).toBe('resumed-run');
    expect(world.row(childId)?.model).toBe(inheritedModel.id);
    expect((yield* world.runStore.runsOf(childId)).map((run) => run.id)).toEqual(['paused-run', 'resumed-run']);
  }),
);
it.effect(
  'a move refuses a stranger child, pinned adapter, empty selection and unoffered rung',
  Effect.fnUntraced(function* () {
    const parent = spawnParent(ordinaryModel, ordinaryRung);
    const world = yield* movePlane(parent);
    const stranger = { ...parent, id: 'stranger' };
    yield* world.seed(stranger);
    yield* world.seed(childOf(stranger, 'child-of-stranger', ordinaryModel, ordinaryRung));
    yield* world.seed(childOf(parent, 'child-harness', ordinaryModel, ordinaryRung, { agentId: 'harness' }));
    yield* world.seed(childOf(parent, 'child-resting', ordinaryModel, ordinaryRung));
    const unoffered = shipped.reasoningLevelIds().find((level) => !ordinaryModel.reasoningOptions.some((rung) => rung.id === level))!;
    const refusal = (threadId: string, model: Parameters<ThreadActing['move']>[0]['model']) =>
      Effect.map(Effect.flip(world.access.move({ threadId, model, key: `call-${threadId}` })), (failure) => planeRefusalOf(failure)?.code);
    expect(yield* refusal('child-of-stranger', { model: ordinaryModel.id })).toBe('not-a-child');
    expect(yield* refusal('child-harness', { model: ordinaryModel.id })).toBe('model-pinned');
    expect(yield* refusal('child-resting', {})).toBe('selection-empty');
    expect(yield* refusal('child-resting', { reasoning: unoffered })).toBe('reasoning-unoffered');
    const unserved = planeRefusalOf(
      yield* Effect.flip(world.access.move({ threadId: 'child-resting', model: { model: `${ordinaryModel.id}x` }, key: 'call-unserved' })),
    );
    expect(unserved?.code).toBe('model-unserved');
    const named = (unserved?.unblock[0] ?? '').split(': ').at(-1)!.split(', ');
    expect(named[0]).toBe(ordinaryModel.id);
    expect(named.length).toBeLessThanOrEqual(3);
    expect(world.row('child-resting')).toMatchObject({ model: ordinaryModel.id, reasoning: ordinaryRung });
    expect(world.moved).toEqual([]);
  }),
);
it.effect(
  'a spawn naming a provider its children are not offered refuses model-unserved naming the offered providers',
  Effect.fnUntraced(function* () {
    const hidden = shipped.options.find((option) => option.provider !== ordinaryModel.provider)!.provider;
    const world = yield* spawnWorld(modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS.filter((provider) => provider.id !== hidden)));
    const parent = spawnParent(ordinaryModel, ordinaryRung);
    yield* world.seed(parent);
    const access = yield* world.acting(parent, 'run-parent');
    const refused = planeRefusalOf(
      yield* Effect.flip(access.spawn({ requestId: 'hidden', agentId: 'tagma', task: 'Work', model: { provider: hidden } })),
    );
    expect(refused?.code).toBe('model-unserved');
    expect(refused?.unblock[0]).toContain(ordinaryModel.provider);
    expect(refused?.unblock[0]).not.toContain(hidden);
  }),
);
it.effect(
  'set_agent_model returns its resolved move and forwards the provider and call key',
  Effect.fnUntraced(function* () {
    const selection = { provider: ordinaryModel.provider, model: ordinaryModel.id, reasoning: ordinaryRung, account: null };
    const asked: Parameters<ThreadActing['move']>[0][] = [];
    const catalog = tools({
      startable,
      move: (input) => {
        asked.push(input);
        return Effect.succeed({
          threadId: input.threadId,
          from: selection,
          to: { provider: inheritedModel.provider, model: inheritedModel.id, reasoning: inheritedRung },
        });
      },
    });
    const answer = yield* execute(
      catalog.set_agent_model!,
      { threadId: 'thread-native', provider: inheritedModel.provider },
      call('call-move', []),
    );
    expect(asked).toEqual([{ threadId: 'thread-native', model: { provider: inheritedModel.provider }, key: 'call-move', asked: [] }]);
    expect(answer.display?.subtitle).toBe(`to ${modelWords(inheritedModel, inheritedRung)}`);
    expect(answer.display?.details?.map((fact) => fact.value)).toEqual([
      `${ordinaryModel.provider}/${ordinaryModel.id} ${ordinaryRung}`,
      `${inheritedModel.provider}/${inheritedModel.id} ${inheritedRung}`,
    ]);
  }),
);
it.effect(
  'a root spawn is born outside the caller’s tree, its replay answers the same thread and a changed replay refuses',
  Effect.fnUntraced(function* () {
    const world = yield* spawnWorld();
    const parent = spawnParent(ordinaryModel, ordinaryRung);
    yield* world.seed(parent);
    const access = yield* world.acting(parent, 'run-parent');
    const ask = { requestId: 'desk', agentId: 'tagma', task: 'Lead the desk', root: true, title: 'Desk' };
    const born = yield* access.spawn(ask);
    expect(world.row(born.threadId)).toMatchObject({ parentThreadId: null, spawnRootId: born.threadId, createdBy: parent.id });
    expect((yield* access.spawn(ask)).threadId).toBe(born.threadId);
    expect(planeRefusalOf(yield* Effect.flip(access.spawn({ ...ask, title: 'Another desk' })))?.code).toBe('spawn-conflict');
  }),
);
it.effect(
  'an interrupt identifies self and ancestor lineage and reaches its addressed ancestor',
  Effect.fnUntraced(function* () {
    const world = yield* spawnWorld();
    const parent = spawnParent(ordinaryModel, ordinaryRung);
    yield* world.seed(parent);
    const parentAccess = yield* world.acting(parent, 'run-parent');
    const spawned = yield* parentAccess.spawn({ requestId: 'child', agentId: 'tagma', task: 'Work' });
    const child = world.row(spawned.threadId)!;
    const childAccess = yield* world.acting(child, 'run-child');
    const lineage = (access: ThreadActing, to: readonly string[]) =>
      Effect.map(access.messaging.lineage(to), (found) => found.map((one) => [one.thread.id, one.lineage]));
    expect(yield* lineage(childAccess, [parent.id, child.id, child.id])).toEqual([
      [parent.id, 'ancestor'],
      [child.id, 'self'],
    ]);
    expect(yield* lineage(parentAccess, [child.id])).toEqual([]);
    yield* childAccess.messaging.send({ to: [parent.id], intent: 'interrupt', text: 'Stop.', key: 'interrupt-parent' });
    expect(world.interrupted).toEqual([parent.id]);
  }),
);
it.effect(
  'a held spawn name refuses and identifies its holder without creating another child',
  Effect.fnUntraced(function* () {
    const source = spawnParent(inheritedModel, inheritedRung);
    const world = yield* movePlane(source);
    const first = yield* world.access.spawn({ requestId: 'first', agentId: 'tagma', task: 'Take the name', name: 'reviewer' });
    expect(world.row(first.threadId)?.name).toBe('reviewer');
    const refused = planeRefusalOf(
      yield* Effect.flip(world.access.spawn({ requestId: 'second', agentId: 'tagma', task: 'Take it again', name: 'reviewer' })),
    );
    expect(refused?.code).toBe('name-taken');
    expect(refused?.reason).toContain(first.threadId);
    expect([...world.memory.threads.values()].filter((held) => held.row.name === 'reviewer')).toHaveLength(1);
  }),
);
it.effect(
  'a free name and an anonymous spawn both land their requested identity',
  Effect.fnUntraced(function* () {
    const source = spawnParent(inheritedModel, inheritedRung);
    const world = yield* movePlane(source);
    const named = yield* world.access.spawn({ requestId: 'named', agentId: 'tagma', task: 'Take a free name', name: 'scout' });
    expect(world.row(named.threadId)?.name).toBe('scout');
    const anonymous = yield* world.access.spawn({ requestId: 'anonymous', agentId: 'tagma', task: 'No name at all' });
    expect(world.row(anonymous.threadId)?.name).toBeNull();
  }),
);
