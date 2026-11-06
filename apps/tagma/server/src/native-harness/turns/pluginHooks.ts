import { agentRule, type AgentDirective, type AgentRule, type AgentRuleContext } from '@runlith/agent/AgentRuntimePolicy';
import { agentReaderInput } from '@runlith/agent/AgentSignal';
import type { Message } from '@runlith/llm/schema/messages';
import type { HookCall, HookSession } from '@runlith/tagma/plugin/protocol';
import { Effect, FiberSet } from 'effect';
import { EnabledPlugins } from '../../plugins/contract/service/plugins.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { ThreadContext } from './context.js';

const RULE_ID = 'plugin-hooks';
const LAST = 1_000;

type Running = { readonly projectId: number; readonly session: HookSession };
type Held = { started: boolean; continued: boolean; readonly prompted: Set<string> };

const textOf = (message: Message): string =>
  typeof message.content === 'string'
    ? message.content
    : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n');

const said = (text: string | undefined): AgentDirective[] => (text === undefined || text.length === 0 ? [] : [{ type: 'guide', text }]);

export const makePluginHooks = Effect.gen(function* () {
  const plugins = yield* EnabledPlugins;
  const records = yield* ThreadRecords;
  const running = new Map<string, Running>();

  const answers = Effect.fn('native-harness.pluginHooks')(
    function* (projectId: number, call: HookCall, session: HookSession) {
      const hooks = (yield* plugins.hooks(projectId)).filter((hook) => hook.at === call.at && hook.matches(call));
      return yield* Effect.forEach(
        hooks,
        (hook) =>
          Effect.tap(hook.run(call, session), (answer) =>
            answer.failure === undefined
              ? Effect.void
              : Effect.logWarning('a plugin hook failed without blocking', { label: hook.label, failure: answer.failure }),
          ),
        { concurrency: 'unbounded' },
      );
    },
    (effect, projectId, call) => Effect.annotateLogs(effect, { projectId, point: call.at }),
  );

  const ended = (threadId: string, reason: 'archive' | 'delete') => {
    const was = running.get(threadId);
    if (was === undefined) return Effect.void;
    running.delete(threadId);
    return answers(was.projectId, { at: 'threadEnded', reason }, was.session).pipe(
      Effect.catchTag('PluginsUnreadable', (unreadable) =>
        Effect.logWarning('the end hooks of a thread could not read its plugins', { threadId, reason: unreadable.reason }),
      ),
      Effect.asVoid,
    );
  };

  const unread = (threadId: string, failure: { readonly message: string }) =>
    Effect.logWarning('the end hooks of an archived thread did not run: its record could not be read', {
      threadId,
      reason: failure.message,
    });

  const runFork = yield* FiberSet.makeRuntime<never, void, never>();
  const unshelved = records.shelfRecorded((event) =>
    Effect.sync(() => {
      for (const threadId of event.threadIds) {
        if (!running.has(threadId)) continue;
        runFork(
          Effect.flatMap(records.facts(threadId), (facts) => (facts?.archivedAt == null ? Effect.void : ended(threadId, 'archive'))).pipe(
            Effect.catchTags({
              EffectDrizzleQueryError: (failure) => unread(threadId, failure),
              SqlError: (failure) => unread(threadId, failure),
              ThreadStorageFailed: (failure) => unread(threadId, failure),
            }),
          ),
        );
      }
    }),
  );
  const unremoved = records.removalRecorded((address) => Effect.sync(() => void runFork(ended(address.threadId, 'delete'))));
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unshelved();
      unremoved();
    }),
  );

  const firstRun = (ctx: AgentRuleContext<ThreadContext>): boolean => !ctx.thread.history.some((message) => message.role === 'assistant');

  const prompts = (ctx: AgentRuleContext<ThreadContext>, held: Held): readonly { readonly input: string; readonly text: string }[] => {
    if (ctx.hook !== 'beforeStep') return [];
    const fresh = new Set((ctx.readerInputs ?? []).filter((input) => !held.prompted.has(input)));
    for (const input of fresh) held.prompted.add(input);
    if (fresh.size === 0) return [];
    return ctx.modelMessages.flatMap((message) => {
      const input = agentReaderInput(message);
      return input !== undefined && fresh.has(input) ? [{ input, text: textOf(message) }] : [];
    });
  };

  const rule: AgentRule<ThreadContext> = agentRule<ThreadContext>(
    RULE_ID,
    Effect.fnUntraced(function* (ctx) {
      const session: HookSession = { threadId: ctx.thread.id, cwd: ctx.world.root };
      running.set(ctx.thread.id, { projectId: ctx.projectId, session });
      const held = ctx.run.ruleState<Held>(RULE_ID, () => ({ started: false, continued: false, prompted: new Set() }));
      const ask = (call: HookCall) => answers(ctx.projectId, call, session);
      if (ctx.hook === 'beforeTool' && ctx.tool !== undefined) {
        const answered = yield* ask({ at: 'beforeTool', tool: ctx.tool.name, input: ctx.tool.input, callId: ctx.tool.toolCallId ?? '' });
        const denied = answered.flatMap((answer) => answer.deny ?? answer.block ?? []);
        const rewritten = answered.find((answer) => answer.rewrite !== undefined)?.rewrite;
        return [
          ...(denied.length > 0 ? [{ type: 'deny', reason: denied.join('\n') } as const] : []),
          ...(denied.length === 0 && rewritten !== undefined ? [{ type: 'rewrite', input: rewritten } as const] : []),
          ...answered.flatMap((answer) => said(answer.context)),
        ];
      }
      if (ctx.hook === 'afterTool' && ctx.tool !== undefined) {
        const answered = yield* ask({
          at: 'afterTool',
          tool: ctx.tool.name,
          input: ctx.tool.input,
          output: ctx.tool.output,
          callId: ctx.tool.toolCallId ?? '',
        });
        return answered.flatMap((answer) => [...said(answer.block), ...said(answer.context)]);
      }
      if (ctx.hook === 'beforeStep') {
        const directives: AgentDirective[] = [];
        if (!held.started) {
          held.started = true;
          if (firstRun(ctx)) {
            for (const answer of yield* ask({ at: 'threadStarted', resumed: false })) directives.push(...said(answer.context));
          }
        }
        for (const prompt of prompts(ctx, held)) {
          for (const answer of yield* ask({ at: 'beforeStep', text: prompt.text })) {
            if (answer.block !== undefined && answer.block.length > 0)
              directives.push({ type: 'guide', text: answer.block, withholds: [prompt.input] });
            directives.push(...said(answer.context));
          }
        }
        return directives;
      }
      if (ctx.hook === 'beforeClose') {
        const answered = yield* ask({ at: 'beforeClose', answer: ctx.steps.at(-1)?.text ?? null, continued: held.continued });
        const blocked = answered.flatMap((answer) => said(answer.block));
        if (blocked.length > 0) held.continued = true;
        return blocked;
      }
      return null;
    }),
    { owner: 'plugins', priority: LAST, critical: false },
  );
  return rule;
});
