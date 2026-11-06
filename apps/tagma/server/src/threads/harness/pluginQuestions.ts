import type { ApprovalNotice } from '@runlith/agent/thread/Approvers';
import { ASKED_LEFT, type AskedInput } from '@runlith/tagma/plugin/protocol';
import { Effect, FiberSet } from 'effect';
import { EnabledPlugins } from '../../plugins/contract/service/plugins.js';
import { pluginCaller, pluginOfCaller } from '../../plugins/contract/wire/names.js';
import { ASKED_REASON, PLUGIN_BINDING } from '../contract/wire/pluginEndings.js';
import type { ThreadLookup } from '../contract/service/reads.js';
import type { OnHook } from './pluginEndings.js';

export type PluginQuestions = {
  readonly owner: (threadId: string, questionId: string) => Effect.Effect<string | null, { readonly message: string }>;
  readonly ask: (approver: string, notice: ApprovalNotice) => boolean;
};

const keyOf = (threadId: string, questionId: string): string => `${threadId}\u0000${questionId}`;

export const makePluginQuestions = Effect.fnUntraced(function* (input: {
  readonly lookup: ThreadLookup['Service'];
  readonly asking: (plugin: string) => OnHook | undefined;
  readonly reroute: (threadId: string) => Effect.Effect<void, unknown>;
}) {
  const { lookup, asking, reroute } = input;
  const enabled = yield* EnabledPlugins;
  const left = new Set<string>();
  const taken = new Set<string>();
  const runFork = yield* FiberSet.makeRuntime<never, void, never>();

  const owner = Effect.fn('PluginQuestions.owner')(function* (threadId: string, questionId: string) {
    if (left.has(keyOf(threadId, questionId))) return null;
    const thread = yield* lookup.summary(threadId);
    const plugin = thread?.bindings[PLUGIN_BINDING];
    if (thread === undefined || plugin === undefined || asking(plugin) === undefined) return null;
    const running = yield* enabled.held(thread.projectId);
    return running().includes(plugin) ? pluginCaller(plugin) : null;
  });

  const handBack = (notice: ApprovalNotice, why: string) =>
    Effect.andThen(
      Effect.sync(() => left.add(keyOf(notice.threadId, notice.questionId))),
      Effect.andThen(
        Effect.logInfo(`a plugin's question went back to the person: ${why}`, { threadId: notice.threadId, questionId: notice.questionId }),
        reroute(notice.threadId),
      ),
    );

  const deliver = Effect.fn('PluginQuestions.deliver')(function* (plugin: string, notice: ApprovalNotice) {
    const hook = asking(plugin);
    const thread = yield* lookup.summary(notice.threadId);
    if (hook === undefined || thread === undefined) return yield* handBack(notice, `${plugin} takes no questions now`);
    const asked: AskedInput = {
      threadId: notice.threadId,
      questionId: notice.questionId,
      summary: notice.summary,
      prompts: notice.prompts,
      deadlineAt: notice.deadlineAt,
    };
    const answer = yield* hook.contribution.caller.call(plugin, hook.tool, asked, {
      caller: { kind: 'tagma', projectId: thread.projectId, reason: ASKED_REASON },
    });
    if ('isError' in answer && answer.isError === true) return yield* handBack(notice, `${plugin} answered with an error`);
    const said = 'structuredContent' in answer ? answer.structuredContent : undefined;
    if (said?.question === ASKED_LEFT.question) return yield* handBack(notice, `${plugin} left it to the person`);
    taken.add(notice.id);
  });

  return {
    owner,
    ask: (approver, notice) => {
      const plugin = pluginOfCaller(approver);
      if (plugin === null) return false;
      if (taken.has(notice.id)) return true;
      runFork(
        deliver(plugin, notice).pipe(
          Effect.catchCause((cause) =>
            handBack(notice, `${plugin} could not be asked`).pipe(Effect.annotateLogs({ cause: String(cause) })),
          ),
          Effect.catchCause((cause) => Effect.logWarning('a plugin question stayed on its route after a failed hand-back', { cause })),
        ),
      );
      return true;
    },
  } satisfies PluginQuestions;
});
