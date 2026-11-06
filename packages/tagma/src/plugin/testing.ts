import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type McpCaller, mcpCallerMeta } from '@runlith/mcp/caller';
import type { McpServedResult } from '@runlith/mcp/server';
import { manifestOf } from './describe.js';
import type { OperationId, PluginDefinition, TagmaClient } from './plugin.js';
import {
  type ActionInput,
  type BuildStepInput,
  type EndingInput,
  handlerTools,
  type HookInput,
  type NotificationInput,
  PROJECTS_META_KEY,
  TAGMA_REASONS,
  type TickInput,
} from './protocol.js';
import { servingOf } from './serving.js';

export type TestedAnswer = {
  readonly text: string;
  readonly isError: boolean;
  readonly structured?: Readonly<Record<string, unknown>>;
};

export type TagmaDouble = (operation: OperationId, input: unknown, project: number | null) => Promise<unknown>;

export type TestPluginOptions = {
  readonly options?: Readonly<Record<string, string>>;
  readonly data?: string;
  readonly projects?: readonly number[];
  readonly tagma?: TagmaDouble;
};

export type TestedPlugin = {
  readonly manifest: ReturnType<typeof manifestOf>;
  readonly call: (tool: string, input?: Readonly<Record<string, unknown>>, caller?: McpCaller) => Promise<TestedAnswer>;
  readonly tick: (schedule: string, tick?: Partial<Omit<TickInput, 'name'>>) => Promise<TestedAnswer>;
  readonly end: (ending: EndingInput, project?: number | null) => Promise<TestedAnswer>;
  readonly notify: (answer: NotificationInput) => Promise<TestedAnswer>;
  readonly build: (step: string, input: BuildStepInput, project?: number | null) => Promise<TestedAnswer>;
  readonly act: (
    action: string,
    project?: number | null,
    from?: { readonly threadId?: string; readonly args?: string },
  ) => Promise<TestedAnswer>;
  readonly check: (hook: string, event: HookInput, project?: number | null) => Promise<TestedAnswer>;
  readonly read: (uri: string, caller?: McpCaller) => Promise<TestedAnswer>;
  readonly changed: readonly string[];
};

const AGENT: McpCaller = { kind: 'agent', projectId: 1, agentId: 'tester', ownerId: 'tester', thread: null };

const unreachable: TagmaDouble = (operation) => Promise.reject(new Error(`${operation}: this test gave testPlugin no tagma double`));

const testedOf = (result: McpServedResult): TestedAnswer =>
  result.structuredContent === undefined
    ? { text: result.text, isError: result.isError === true }
    : { text: result.text, isError: result.isError === true, structured: result.structuredContent };

export const testPlugin = (definition: PluginDefinition, given: TestPluginOptions = {}): TestedPlugin => {
  const double = given.tagma ?? unreachable;
  const client = (project: number | null): TagmaClient => ({
    op: (id, input) => double(id, input, project) as never,
    in: (other) => client(other),
  });
  const changed: string[] = [];
  let data = given.data;
  const serving = servingOf(definition, {
    get data() {
      data ??= mkdtempSync(join(tmpdir(), `${definition.id}-data-`));
      return data;
    },
    options: Object.fromEntries((definition.options ?? []).map((option) => [option.key, given.options?.[option.key] ?? option.default])),
    client,
    log: (text) => process.stderr.write(`${text}\n`),
    changed: (uri) => changed.push(uri),
  });
  const meta = (caller: McpCaller) => ({ ...mcpCallerMeta(caller), [PROJECTS_META_KEY]: given.projects ?? [] });
  const call = async (tool: string, input: Readonly<Record<string, unknown>>, caller: McpCaller): Promise<TestedAnswer> =>
    testedOf(await serving.call(tool, input, meta(caller), new AbortController().signal));
  const tagma = (projectId: number | null, reason: string): McpCaller => ({ kind: 'tagma', projectId, reason });
  return {
    manifest: manifestOf(serving.description),
    call: (tool, input = {}, caller = AGENT) => call(tool, input, caller),
    tick: (schedule, tick = {}) => {
      const now = Date.now();
      return call(
        handlerTools.schedule(schedule),
        { name: schedule, scheduledAt: tick.scheduledAt ?? now, startedAt: tick.startedAt ?? now, skipped: tick.skipped ?? 0 },
        tagma(null, TAGMA_REASONS.schedule),
      );
    },
    end: (ending, project = AGENT.projectId) => call(handlerTools.ended, ending, tagma(project, TAGMA_REASONS.ended)),
    notify: (answer) => call(handlerTools.notification, answer, tagma(null, TAGMA_REASONS.notification)),
    build: (step, input, project = AGENT.projectId) => call(handlerTools.build(step), input, tagma(project, TAGMA_REASONS.build)),
    act: (action, project = AGENT.projectId, { threadId, args = '' }: { readonly threadId?: string; readonly args?: string } = {}) =>
      call(handlerTools.action(action), { args } satisfies ActionInput, {
        kind: 'operator',
        projectId: project,
        view: `action:${action}`,
        ...(threadId === undefined ? {} : { threadId }),
      }),
    check: (hook, event, project = AGENT.projectId) => call(handlerTools.hook(hook), event, tagma(project, TAGMA_REASONS.hook)),
    read: async (uri, caller = AGENT) => {
      const read = await serving.read(uri, meta(caller), new AbortController().signal);
      return 'refused' in read ? { text: read.refused, isError: true } : { text: read.text, isError: false };
    },
    changed,
  };
};
