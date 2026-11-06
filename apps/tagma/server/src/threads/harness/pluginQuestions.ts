import type { ApprovalNotice, ApprovalPrompt } from '@runlith/agent/thread/Approvers';
import { ASKED_LEFT, type AskedInput, type AskedPrompt, TAGMA_REASONS } from '@runlith/tagma/plugin/protocol';
import { eq, sql } from 'drizzle-orm';
import { Cause, Effect, FiberSet, Stream } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { PluginTools } from '../../plugin-host/contract/service/tools.js';
import { EnabledPlugins } from '../../plugins/contract/service/plugins.js';
import { pluginCaller, pluginOfCaller } from '../../plugins/contract/wire/names.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { openQuestions } from '../approvers.js';
import type { ThreadHarness } from '../contract/service/engine.js';
import type { ThreadLookup } from '../contract/service/reads.js';
import { PLUGIN_BINDING } from '../contract/wire/on.js';
import { threadMandate } from '../store/mandate.js';
import type { PluginOn } from './pluginOn.js';

type Owner = { readonly approver: string; readonly name: string };

export type PluginQuestions = {
  readonly owner: (plugin: string, projectId: number) => Effect.Effect<Owner | null, { readonly message: string }>;
  readonly ask: (approver: string, notice: ApprovalNotice) => boolean;
};

const askedPrompt = (prompt: ApprovalPrompt): AskedPrompt => ({
  id: prompt.id,
  prompt: prompt.prompt,
  ...(prompt.header === undefined ? {} : { header: prompt.header }),
  options: prompt.options.map((option) => ({
    value: option.value,
    label: option.label,
    ...(option.description === undefined ? {} : { description: option.description }),
  })),
  freeform: prompt.freeform,
  multiple: prompt.multiple,
});

type Bound = { readonly plugin?: string; readonly projectId?: number };

export const makePluginQuestions = Effect.fnUntraced(function* (input: {
  readonly on: PluginOn;
  readonly lookup: ThreadLookup['Service'];
  readonly harness: Effect.Effect<ThreadHarness['Service']>;
}) {
  const { on, lookup, harness } = input;
  const enabled = yield* EnabledPlugins;
  const tools = yield* PluginTools;
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const runFork = yield* FiberSet.makeRuntime<never, void, never>();

  const owner = Effect.fn('PluginQuestions.owner')(function* (
    plugin: string,
    projectId: number,
  ): Effect.fn.Return<Owner | null, { readonly message: string }> {
    const hook = on.asking(plugin);
    if (hook === undefined || tools.failed(plugin)) return null;
    const running = yield* enabled.held(projectId);
    return running().includes(plugin) ? { approver: pluginCaller(plugin), name: hook.contribution.plugin.title } : null;
  });

  const rerouted = Effect.fn('PluginQuestions.rerouted')(function* (bound: Bound, every: boolean) {
    const open = openQuestions(db);
    const plugin = sql<string>`json_extract(${threadMandate.bindings}, ${`$.${PLUGIN_BINDING}`})`;
    const standing = yield* units.read((unit) =>
      unit.run(
        db
          .select({ id: open.id, plugin, projectId: threadRecord.projectId })
          .from(open)
          .innerJoin(threadMandate, eq(threadMandate.id, open.id))
          .innerJoin(threadRecord, eq(threadRecord.id, open.id))
          .where(
            sql`${plugin} is not null${bound.plugin === undefined ? sql`` : sql` and ${plugin} = ${bound.plugin}`}${
              bound.projectId === undefined ? sql`` : sql` and ${threadRecord.projectId} = ${bound.projectId}`
            }`,
          ),
      ),
    );
    const questions = (yield* harness).runs.questions();
    for (const row of standing) {
      const wanted = row.projectId === null ? null : ((yield* owner(row.plugin, row.projectId))?.approver ?? null);
      const routed = (yield* questions.open(row.id)).filter((entry) => entry.declinedBy === undefined);
      if (every ? routed.length > 0 : routed.some((entry) => (entry.approver ?? null) !== wanted)) yield* questions.reroute(row.id);
    }
  });

  const follow = (bound: Bound, every: boolean): void => {
    runFork(
      rerouted(bound, every).pipe(
        Effect.catchCause((cause) => Effect.logWarning('a plugin change left questions on their former route', { bound, cause })),
      ),
    );
  };
  const unasked = on.changed((plugin) => follow({ plugin }, on.asking(plugin) !== undefined));
  yield* Effect.addFinalizer(() => Effect.sync(unasked));
  const unbroken = tools.followFailed((plugin) => follow({ plugin }, !tools.failed(plugin)));
  yield* Effect.addFinalizer(() => Effect.sync(unbroken));
  yield* Effect.forkScoped(
    Stream.runForEach(enabled.changes, (projectId) => Effect.sync(() => follow(projectId === null ? {} : { projectId }, false))),
  );

  const handBack = (plugin: string, notice: ApprovalNotice, why: string) =>
    Effect.andThen(
      Effect.logInfo(`a plugin's question went back to the person: ${why}`, { threadId: notice.threadId, questionId: notice.questionId }),
      Effect.flatMap(harness, (standing) =>
        standing.runs.questions().decline({ threadId: notice.threadId, questionId: notice.questionId, caller: pluginCaller(plugin) }),
      ),
    );

  const deliver = Effect.fn('PluginQuestions.deliver')(function* (plugin: string, notice: ApprovalNotice) {
    const hook = on.asking(plugin);
    const thread = yield* lookup.find(notice.threadId, OPERATOR_PRINCIPAL);
    if (hook === undefined || thread === undefined) return yield* handBack(plugin, notice, `${plugin} takes no questions now`);
    const asked: AskedInput = {
      threadId: notice.threadId,
      questionId: notice.questionId,
      summary: notice.summary,
      prompts: notice.prompts === null ? null : notice.prompts.map(askedPrompt),
      deadlineAt: notice.deadlineAt,
    };
    const answer = yield* hook.contribution.caller.call(plugin, hook.tool, asked, {
      caller: { kind: 'tagma', projectId: thread.projectId, reason: TAGMA_REASONS.asked },
    });
    if ('isError' in answer && answer.isError === true) return yield* handBack(plugin, notice, `${plugin} answered with an error`);
    const said = 'structuredContent' in answer ? answer.structuredContent : undefined;
    if (said?.question === ASKED_LEFT.question) return yield* handBack(plugin, notice, `${plugin} left it to the person`);
  });

  return {
    owner,
    ask: (approver, notice) => {
      const plugin = pluginOfCaller(approver);
      if (plugin === null) return false;
      runFork(
        deliver(plugin, notice).pipe(
          Effect.catchCause((cause) =>
            handBack(plugin, notice, `${plugin} could not be asked`).pipe(Effect.annotateLogs({ cause: Cause.pretty(cause) })),
          ),
          Effect.catchCause((cause) => Effect.logWarning('a plugin question stayed on its route after a failed hand-back', { cause })),
        ),
      );
      return true;
    },
  } satisfies PluginQuestions;
});
