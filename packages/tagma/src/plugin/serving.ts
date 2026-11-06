import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type McpCaller, MCP_CALLER_META_KEY } from '@runlith/mcp/caller';
import type { McpServedResult, McpServedTool } from '@runlith/mcp/server';
import { describePlugin, type PluginDescription } from './describe.js';
import { issueText } from './issues.js';
import { modelsClient } from './models.js';
import { serversClient } from './servers.js';
import { type PluginContext, type PluginDefinition, Refusal, type TagmaClient, type Tool } from './plugin.js';
import type { HookVerdicts } from './points.generated.js';
import {
  type ActionInput,
  type AskedInput,
  type BuildStepInput,
  type EndingInput,
  type HookInput,
  handlerTools,
  type NotificationInput,
  PROJECTS_META_KEY,
  type TickInput,
} from './protocol.js';
import { toolResultOf } from './value.js';

type ServingPlace = {
  readonly data: string;
  readonly options: Readonly<Record<string, string | undefined>>;
  readonly client: (project: number | null, signal: AbortSignal) => TagmaClient;
  readonly log: (text: string) => void;
  readonly changed: (uri: string) => void;
};

type ServedResource = {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly template: boolean;
};

const PLACEHOLDER = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/gu;

const templateOf = (
  uri: string,
): { readonly template: boolean; readonly matches: (read: string) => Readonly<Record<string, string>> | null } => {
  const names = [...uri.matchAll(PLACEHOLDER)].map((match) => match[1]!);
  if (names.length === 0) return { template: false, matches: (read) => (read === uri ? {} : null) };
  const pattern = new RegExp(
    `^${uri
      .split(PLACEHOLDER)
      .map((part, at) => (at % 2 === 1 ? '([^/?#]+)' : part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')))
      .join('')}$`,
    'u',
  );
  return {
    template: true,
    matches: (read) => {
      const matched = pattern.exec(read);
      return matched === null ? null : Object.fromEntries(names.map((name, at) => [name, decodeURIComponent(matched[at + 1]!)]));
    },
  };
};

type ResourceRead = { readonly text: string; readonly mimeType: string } | { readonly refused: string };

type Serving = {
  readonly description: PluginDescription;
  readonly tools: readonly McpServedTool[];
  readonly resources: readonly ServedResource[];
  readonly call: (
    tool: string,
    input: Readonly<Record<string, unknown>>,
    meta: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ) => Promise<McpServedResult>;
  readonly read: (uri: string, meta: Readonly<Record<string, unknown>>, signal: AbortSignal) => Promise<ResourceRead>;
};

type Handler = (input: Readonly<Record<string, unknown>>, ctx: PluginContext) => Promise<McpServedResult>;

const CALLER_KINDS: ReadonlySet<string> = new Set<McpCaller['kind']>(['agent', 'operator', 'tagma']);

const callerOf = (meta: Readonly<Record<string, unknown>>): McpCaller | null => {
  const caller = meta[MCP_CALLER_META_KEY];
  if (typeof caller !== 'object' || caller === null) return null;
  const { kind, projectId } = caller as { readonly kind?: unknown; readonly projectId?: unknown };
  return typeof kind === 'string' && CALLER_KINDS.has(kind) && (projectId === null || Number.isInteger(projectId))
    ? (caller as McpCaller)
    : null;
};

const projectsOf = (meta: Readonly<Record<string, unknown>>): readonly number[] => {
  const projects = meta[PROJECTS_META_KEY];
  return Array.isArray(projects) ? projects.filter((one): one is number => Number.isInteger(one)) : [];
};

const textOf = (part: unknown): string => {
  if (typeof part === 'string') return part;
  if (part instanceof Error) return part.stack ?? part.message;
  return JSON.stringify(part) ?? String(part);
};

const isPlain = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

const answered = (value: unknown): McpServedResult => {
  if (value === undefined) return { text: '' };
  if (typeof value === 'string') return { text: value };
  return { text: JSON.stringify(value), structuredContent: isPlain(value) ? value : undefined };
};

const failed = (error: unknown): McpServedResult => ({
  text: error instanceof Refusal ? error.reason : error instanceof Error ? error.message : String(error),
  isError: true,
});

type Verdict = HookVerdicts[keyof HookVerdicts];

const hookAnswered = (verdict: Verdict | void): McpServedResult => {
  const answer: Readonly<Record<string, unknown>> = verdict ?? {};
  return { text: JSON.stringify(answer), structuredContent: answer };
};

const authored =
  (declared: Tool): Handler =>
  async (input, ctx) => {
    if (declared.input === undefined) return toolResultOf(await declared.run(input, ctx));
    const checked = await declared.input['~standard'].validate(input);
    if (checked.issues !== undefined) return { text: `Invalid input: ${checked.issues.map(issueText).join('; ')}`, isError: true };
    return toolResultOf(await declared.run(checked.value as never, ctx));
  };

const handlersOf = (definition: PluginDefinition): ReadonlyMap<string, Handler> => {
  const handlers = new Map<string, Handler>();
  for (const [name, declared] of Object.entries(definition.tools ?? {})) handlers.set(name, authored(declared));
  for (const [name, declared] of Object.entries(definition.schedules ?? {}))
    handlers.set(handlerTools.schedule(name), async (input, ctx) => answered(await declared.run(input as unknown as TickInput, ctx)));
  for (const [name, step] of Object.entries(definition.beforeBuild ?? {}))
    handlers.set(handlerTools.build(name), async (input, ctx) => ({
      text: JSON.stringify(await step.run(input as unknown as BuildStepInput, ctx)),
    }));
  for (const [name, declared] of Object.entries(definition.actions ?? {}))
    handlers.set(handlerTools.action(name), async (input, ctx) => answered(await declared.run(input as unknown as ActionInput, ctx)));
  for (const [name, declared] of Object.entries(definition.hooks ?? {}))
    handlers.set(handlerTools.hook(name), async (input, ctx) =>
      hookAnswered(
        await (declared.run as (event: HookInput, ctx: PluginContext) => Promise<Verdict | void>)(input as unknown as HookInput, ctx),
      ),
    );
  const { onThreadEnded, onThreadAsked, onNotification } = definition;
  if (onThreadEnded !== undefined)
    handlers.set(handlerTools.ended, async (input, ctx) => answered(await onThreadEnded(input as unknown as EndingInput, ctx)));
  if (onThreadAsked !== undefined)
    handlers.set(handlerTools.asked, async (input, ctx) => answered(await onThreadAsked(input as unknown as AskedInput, ctx)));
  if (onNotification !== undefined)
    handlers.set(handlerTools.notification, async (input, ctx) =>
      answered(await onNotification(input as unknown as NotificationInput, ctx)),
    );
  return handlers;
};

export const servingOf = (definition: PluginDefinition, place: ServingPlace): Serving => {
  const description = describePlugin(definition);
  const handlers = handlersOf(definition);
  const resources = Object.entries(definition.resources ?? {}).map(([name, declared]) => ({ name, declared, ...templateOf(declared.uri) }));
  const made = new Set<string>();
  const dataOf = (project: number | null): string => {
    const path = join(place.data, project === null ? 'machine' : join('projects', String(project)));
    if (!made.has(path)) {
      mkdirSync(path, { recursive: true });
      made.add(path);
    }
    return path;
  };
  const contextOf = (caller: McpCaller, projects: readonly number[], signal: AbortSignal): PluginContext => {
    const tagma = place.client(caller.projectId, signal);
    return {
      caller,
      project: caller.projectId,
      projects,
      tagma,
      models: modelsClient(tagma),
      servers: serversClient(tagma),
      get data() {
        return dataOf(caller.projectId);
      },
      dataOf,
      options: place.options,
      log: (...parts) => place.log(parts.map(textOf).join(' ')),
      signal,
      changed: place.changed,
    };
  };
  return {
    description,
    tools: description.tools,
    resources: resources.map(({ name, declared, template }) => ({
      uri: declared.uri,
      name,
      description: declared.description,
      mimeType: declared.mimeType,
      template,
    })),
    call: async (tool, input, meta, signal) => {
      const handler = handlers.get(tool);
      if (handler === undefined) return { text: `${description.id} serves no tool ${tool}`, isError: true };
      const caller = callerOf(meta);
      if (caller === null) return { text: `the call carries no caller in _meta["${MCP_CALLER_META_KEY}"]`, isError: true };
      try {
        return await handler(input, contextOf(caller, projectsOf(meta), signal));
      } catch (error) {
        return failed(error);
      }
    },
    read: async (uri, meta, signal) => {
      const found = resources.flatMap(({ declared, matches }) => {
        const params = matches(uri);
        return params === null ? [] : [{ declared, params }];
      })[0];
      if (found === undefined) return { refused: `${description.id} serves no resource ${uri}` };
      const caller = callerOf(meta);
      if (caller === null) return { refused: `the read carries no caller in _meta["${MCP_CALLER_META_KEY}"]` };
      const { declared, params } = found;
      try {
        const value = await declared.read(params, contextOf(caller, projectsOf(meta), signal));
        return typeof value === 'string'
          ? { text: value, mimeType: declared.mimeType ?? 'text/plain' }
          : { text: JSON.stringify(value), mimeType: declared.mimeType ?? 'application/json' };
      } catch (error) {
        return { refused: failed(error).text };
      }
    },
  };
};
