import { resolve } from 'node:path';
import {
  type Tool,
  type ToolEffectSettlement,
  type ToolPreparationCall,
  type ToolSettleCall,
  ToolAnswer,
  ToolFailed,
  toolPrepare,
  toolSubjects,
} from '@runlith/agent/tool';
import type { PermissionSubject } from '@runlith/agent/permissions';
import type { GraphOrigin } from '../../threads/contract/wire/target.js';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import type { ToolCatalog } from '@runlith/agent/catalog';
import { createTools } from '@runlith/agent-tools';
import { Effect } from 'effect';
import { ACT_VARIABLE, actValue } from '../../platform/contract/service/credentials.js';
import { nobodyEnvironment, grantEnvironment } from '../../platform/credentials/grants.js';
import { checkoutMode, commentPolicy } from '../../graph/settings.js';
import { checkoutSettingAt, governingProject, settingAt } from '../../workspace/governing.js';
import type { CheckoutWorld } from '../../executions/contract/wire/world.js';
import { CHECKOUT_DIRECTORY } from '../../graph/contract/wire/storage.js';
import type { ToolCaller, ToolCallerThread } from '@runlith/agent/contracts';
import type { ToolEnvCall } from '@runlith/agent-tools/workspace';
import type { ThreadContext } from '../turns/context.js';
import type { Capability } from './contract.js';
import { workingBindings } from '../../workspace/roots/bindings.js';
import { PLATFORM_REFUSAL_WORDS } from '../../platform/contract/wire/refusal.js';

export function worldTools(ctx: ThreadContext, options: { readonly web: boolean }): ToolCatalog {
  const { world } = ctx;
  const changeRecord = world.facts.shared ? ctx.changeRecord : null;
  const locate = world.facts.shared ? (at: string) => ctx.places.resource(at) : null;
  const governing = governingProject(locate, ctx.projectId);
  const measured =
    changeRecord !== null
      ? {
          changesOf: (caller: ToolCaller) => {
            const calling = callingThread(caller);
            return changeRecord.changes({ work: { projectId: ctx.projectId, threadId: calling.threadId }, runHint: calling.runId });
          },
          unowned: [CHECKOUT_DIRECTORY],
          checkout: settingAt(ctx.settings, governing, checkoutMode),
          flights: ctx.checkoutFlights,
        }
      : {};
  const env = nobodyEnvironment(ctx.identity);
  const callEnv = (call: ToolEnvCall): Record<string, string | undefined> => {
    if (!world.facts.shared) return {};
    const calling = callingThread(call.caller);
    return {
      ...grantEnvironment(ctx.grants, calling.threadId, ctx.identity),
      [ACT_VARIABLE]: call.step === undefined ? undefined : actValue(calling.runId, call.step),
    };
  };
  const web = options.web
    ? {
        websearch: {
          modelName: ctx.thread.model ?? undefined,
          sessions: ctx.webSearch,
        },
      }
    : {};
  const catalog = createTools({
    cwd: world.root,
    allowOutsideCwd: true,
    world: world.world,
    bindings: ctx.origin === null ? undefined : workingBindings(ctx.origin, world.root),
    comments: checkoutSettingAt(ctx.settings, locate, commentPolicy, { projectId: ctx.projectId, value: ctx.comments }, 'allowed'),
    checkoutAt: (tree) => Effect.map(ctx.places.checkoutOf(tree), (place) => place !== null && place.path === ''),
    env,
    callEnv,
    commandTimes: ctx.commandTimes,
    commandDescription: ctx.commandDescription,
    searchMs: LONGEST_ACT_MS,
    ...measured,
    ...web,
  });
  const placed = world.facts.shared
    ? Object.fromEntries(Object.entries(catalog).map(([name, tool]) => [name, inPlace(ctx, tool)]))
    : catalog;
  const substrate = ctx.world.substrate;
  if (substrate === undefined || placed.bash === undefined) return placed;
  return { ...placed, bash: withSubstrate(placed.bash, substrate) };
}

const placesOf = (ctx: ThreadContext, input: unknown, subjects: readonly PermissionSubject[]) => {
  const workdir = typeof input === 'object' && input !== null ? (input as { readonly workdir?: unknown }).workdir : undefined;
  return [
    ...subjects.flatMap((subject) =>
      subject.file === true
        ? [{ path: resolve(ctx.world.root, subject.value), entry: subject.entry === true, tree: subject.tree === true }]
        : [],
    ),
    ...(typeof workdir === 'string' ? [{ path: resolve(ctx.world.root, workdir), entry: false, tree: false }] : []),
  ];
};

const inPlace = (ctx: ThreadContext, tool: Tool): Tool => {
  const enter = (
    input: unknown,
    caller: ToolCaller,
    subjects: readonly PermissionSubject[],
    toolCallId: string,
  ): Effect.Effect<void, ToolFailed> =>
    caller.thread === null
      ? Effect.void
      : Effect.gen(function* () {
          const places = new Map<string, GraphOrigin>();
          const visit = (place: GraphOrigin | null) => {
            if (place !== null && place.projectId !== ctx.projectId) places.set(`${place.projectId}\u0000${place.root}`, place);
          };
          for (const { path, entry, tree } of placesOf(ctx, input, subjects)) {
            visit(yield* entry ? ctx.places.locate(path) : ctx.places.resource(path));
            if (tree) for (const place of yield* ctx.places.within(path)) visit(place);
          }
          for (const place of places.values()) {
            yield* ctx.places.enter({
              threadId: callingThread(caller).threadId,
              home: ctx.projectId,
              place,
              mutates: tool.mutates === true,
              toolCallId,
            });
          }
        }).pipe(
          Effect.mapError((failure) =>
            failure._tag === 'GateRefusal'
              ? new ToolFailed({
                  reason: failure.reason,
                  code: failure.code,
                  unblock: failure.unblock,
                  words: failure.words?.text ?? PLATFORM_REFUSAL_WORDS[failure.code],
                })
              : new ToolFailed({
                  reason: `The place of this act could not be read: ${'reason' in failure ? failure.reason : failure._tag}`,
                }),
          ),
        );
  const prepare = toolPrepare(tool);
  if (prepare !== null) {
    return {
      ...tool,
      prepare: (input: never, call: ToolPreparationCall) =>
        Effect.tap(prepare(input, call), (prepared) => enter(input, call.caller, prepared.subjects, call.toolCallId)),
    } as Tool;
  }
  const { subjects: _declared, ...rest } = tool;
  return {
    ...rest,
    prepare: (input: never, call: ToolPreparationCall) => {
      const subjects = toolSubjects(tool, input, call.caller);
      return Effect.as(enter(input, call.caller, subjects, call.toolCallId), { subjects });
    },
  } as Tool;
};

const callingThread = (caller: ToolCaller): ToolCallerThread => {
  if (caller.thread === null) throw new Error('A workspace tool of a thread was called with no thread.');
  return caller.thread;
};

const withSubstrate = (tool: Tool, substrate: CheckoutWorld): Tool => {
  if (tool.execute === undefined) return tool;
  const execute = tool.execute;
  const marked = (answer: ToolAnswer): ToolAnswer => {
    const display = answer.display;
    if (display === undefined) return answer;
    return new ToolAnswer(
      answer.value,
      { ...display, details: [...(display.details ?? []), { label: 'world', value: substrate }] },
      answer.options,
    );
  };
  const mark = (output: unknown): unknown => (output instanceof ToolAnswer ? marked(output) : output);
  const settle = tool.settleEffect as ((input: ToolSettleCall) => Effect.Effect<ToolEffectSettlement, ToolFailed>) | undefined;
  const receipt = tool.receipt;
  return {
    ...tool,
    execute: (input, call) => Effect.map(execute(input, call), mark),
    receipt:
      receipt === undefined
        ? undefined
        : (call: ToolPreparationCall) => {
            const own = receipt(call);
            return own === undefined ? undefined : marked(own);
          },
    settleEffect:
      settle === undefined
        ? undefined
        : (input: ToolSettleCall<never>) =>
            Effect.map(settle(input), (settlement) =>
              settlement.status === 'completed' ? { ...settlement, output: mark(settlement.output) } : settlement,
            ),
  };
};

export function offeredWorldTools(held: readonly Capability[], catalog: ToolCatalog, exposure: 'eager' | 'deferred'): ToolCatalog {
  return Object.fromEntries(
    held.flatMap((capability) =>
      Object.entries(capability.workspaceTools ?? {}).flatMap(([name, offered]) => {
        const tool = catalog[name];
        return offered !== exposure || tool === undefined ? [] : [[name, exposure === 'deferred' ? { ...tool, exposure } : tool]];
      }),
    ),
  );
}

export function pick(catalog: ToolCatalog, names: readonly string[]): ToolCatalog {
  const kept: Record<string, Tool> = {};
  for (const name of names) {
    const tool = catalog[name];
    if (tool !== undefined) kept[name] = tool;
  }
  return kept;
}
