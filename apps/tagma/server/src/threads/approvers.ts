import { Cause, Effect, Exit, FiberSet } from 'effect';
import { eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import {
  grantCovers,
  type ApprovalNotice,
  type ApprovalPrompt,
  type ApproverRoute,
  type ApproverWhy,
} from '@runlith/agent/thread/Approvers';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../platform/contract/service/units.js';
import { SettingChanges } from '../settings/contract/service/changes.js';
import { threadRecord } from '../thread-record/store/table.js';
import { ENTRY_OPEN_QUESTION_INDEX, THREAD_OPEN_QUESTION_INDEX, thread, threadEntry } from './store/kernel.js';
import { entryField } from './store/fields.js';
import type { ThreadHost } from '@runlith/agent/thread/ThreadPorts';
import { ThreadCallBroke, type ThreadPortFailure } from '@runlith/agent/thread/ThreadBorder';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import type { StoreFailure } from '../platform/contract/service/store.js';
import type { Settings } from '../settings/contract/service/values.js';
import type { ThreadMandate } from './contract/service/mandate.js';
import type { ThreadLookup } from './contract/service/reads.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { among } from '../platform/store/rows.js';
import { approves as approvesKey } from './contract/wire/settings.js';

type ApproversPort = NonNullable<ThreadHost['approvers']>;

export type GrantOrigin = 'own' | 'lineage' | 'setting';

export type ApprovesReading = {
  readonly own: readonly string[] | null;
  readonly effective: readonly string[];
  readonly setAt: string | null;
  readonly origin: GrantOrigin;
};

export const readApproves = Effect.fnUntraced(function* (
  mandate: ThreadMandate['Service'],
  settings: Settings['Service'],
  threadId: string,
  projectId: number,
  unit?: Unit<'machine'>,
): Effect.fn.Return<ApprovesReading, StoreFailure> {
  const lineage = yield* mandate.approvesLineage(threadId, unit);
  if (lineage.nearest !== null) {
    return {
      own: lineage.own,
      effective: lineage.nearest.approves,
      setAt: lineage.nearest.setAt,
      origin: lineage.nearest.setAt === threadId ? 'own' : 'lineage',
    } as const;
  }
  return { own: null, effective: yield* settings.value(approvesKey, projectId, unit), setAt: null, origin: 'setting' } as const;
});

export const followRoutes = Effect.fnUntraced(function* (harness: AgentHarness) {
  const changes = yield* SettingChanges;
  const records = yield* ThreadRecords;
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const parent = alias(threadRecord, 'approving_parent');
  const openQuestions = () =>
    db
      .select({ id: sql<string>`${threadEntry.threadId}`.as('id') })
      .from(sql`${threadEntry} indexed by ${sql.identifier(ENTRY_OPEN_QUESTION_INDEX)}`)
      .where(sql`${threadEntry.type} = 'question' and ${entryField(threadEntry.entry, 'status')} = 'open'`)
      .union(
        db
          .select({ id: sql<string>`${thread.id}`.as('id') })
          .from(sql`${thread} indexed by ${sql.identifier(THREAD_OPEN_QUESTION_INDEX)}`)
          .where(sql`${entryField(thread.pendingInteraction, 'status')} = 'open'`),
      )
      .as('open_questions');
  const reroute = Effect.fn('threads.rerouteApprovals')(function* (projectId: number | null) {
    const open = openQuestions();
    const standing = yield* units.read((unit) =>
      unit.run(
        db
          .select({ id: open.id })
          .from(open)
          .innerJoin(threadRecord, eq(threadRecord.id, open.id))
          .innerJoin(parent, eq(parent.id, threadRecord.parentId))
          .where(projectId === null ? undefined : eq(parent.projectId, projectId)),
      ),
    );
    for (const { id } of standing) yield* harness.runs.questions().reroute(id);
  });
  const rerouteShelved = Effect.fn('threads.rerouteShelved')(function* (threadIds: readonly string[]) {
    if (threadIds.length === 0) return;
    const open = openQuestions();
    const standing = yield* units.read((unit) =>
      unit.run(
        db
          .select({ id: open.id })
          .from(open)
          .innerJoin(threadRecord, eq(threadRecord.id, open.id))
          .where(sql`${threadRecord.id} in ${among(threadIds)} or ${threadRecord.parentId} in ${among(threadIds)}`),
      ),
    );
    for (const { id } of standing) yield* harness.runs.questions().reroute(id);
  });
  const unwatch = changes.subscribe((event) => (event.key === approvesKey.id ? reroute(event.projectId).pipe(Effect.orDie) : Effect.void));
  yield* Effect.addFinalizer(() => Effect.sync(unwatch));
  const runFork = yield* FiberSet.makeRuntime<never, void, never>();
  const unshelve = records.shelfRecorded((event) =>
    Effect.sync(() =>
      runFork(
        rerouteShelved(event.threadIds).pipe(
          Effect.catchCause((cause) => Effect.logWarning('a shelf change left questions on their former route', { event, cause })),
        ),
      ),
    ),
  );
  yield* Effect.addFinalizer(() => Effect.sync(unshelve));
});

export type ApprovalDelivery = (
  threadId: string,
  envelope: { readonly id: string; readonly senderThreadId: null; readonly intent: 'approval'; readonly text: string },
) => Effect.Effect<unknown, unknown>;

const optionLine = (option: ApprovalPrompt['options'][number]): string =>
  `  - ${JSON.stringify(option.value)}${option.label === option.value ? '' : ` — ${option.label}`}${option.description === undefined ? '' : `: ${option.description}`}`;

const takesWords = (prompt: ApprovalPrompt): string =>
  prompt.options.length === 0
    ? 'your own words'
    : `${prompt.multiple ? 'any of these' : 'one of these'}${prompt.freeform ? ', or your own words' : ''}`;

const promptLines = (prompt: ApprovalPrompt, named: boolean): readonly string[] => [
  `- ${named ? `${JSON.stringify(prompt.id)}: ` : ''}${prompt.header === undefined ? '' : `${prompt.header}: `}${prompt.prompt} — ${takesWords(prompt)}`,
  ...prompt.options.map(optionLine),
];

const answerLines = (threadId: string, questionId: string, prompts: readonly ApprovalPrompt[] | null): readonly string[] => {
  const call = (fields: string) => `answer_approval { threadId: "${threadId}", questionId: "${questionId}", ${fields} }`;
  if (prompts === null) return [`Answer with ${call('allow, note?')}.`];
  const [only] = prompts;
  if (prompts.length === 1 && only !== undefined)
    return [`Answer with ${call(only.multiple ? 'values' : 'value')}:`, ...promptLines(only, false)];
  return [
    `Answer with ${call('answers: [{ questionId, values }]')}, one entry per prompt:`,
    ...prompts.flatMap((one) => promptLines(one, true)),
  ];
};

const noticeText = (notice: ApprovalNotice): string =>
  [
    notice.prompts === null
      ? `Thread ${notice.threadId} of your team asks for an approval: ${notice.summary}`
      : `Thread ${notice.threadId} of your team asks: ${notice.summary}`,
    ...answerLines(notice.threadId, notice.questionId, notice.prompts),
    notice.deadlineAt === null ? 'This question has no deadline.' : `Without an answer, this question lapses at ${notice.deadlineAt}.`,
    'Where answer_approval stands among your deferred tools, tool_search "select:answer_approval" reveals it.',
    'Decide as the operator would; the operator can answer it themselves, and the question then closes.',
  ].join('\n');

export type ApproverStanding = {
  readonly approver: string | null;
  readonly why: Exclude<ApproverWhy, 'parent-owns'>;
  readonly grant: ReadonlySet<string>;
};

export type StandingOf = (threadId: string, unit?: Unit<'machine'>) => Effect.Effect<ApproverStanding, StoreFailure | ThreadPortFailure>;

export function approverStanding(
  lookup: ThreadLookup['Service'],
  mandate: ThreadMandate['Service'],
  settings: Settings['Service'],
): StandingOf {
  const none = (why: ApproverStanding['why'], grant: ReadonlySet<string> = new Set()): ApproverStanding => ({
    approver: null,
    why,
    grant,
  });
  return Effect.fnUntraced(function* (threadId, unit) {
    const child = yield* lookup.find(threadId, OPERATOR_PRINCIPAL, unit);
    if (child === undefined || child.parentThreadId === null) return none('no-parent');
    if (yield* mandate.takenOver(threadId, unit)) return none('taken-over');
    const parent = yield* lookup.find(child.parentThreadId, OPERATOR_PRINCIPAL, unit);
    if (parent === undefined || parent.archivedAt != null) return none('no-parent');
    const grant = new Set((yield* readApproves(mandate, settings, parent.id, parent.projectId, unit)).effective);
    return grant.size === 0 ? none('no-grant', grant) : { approver: parent.id, why: 'parent', grant };
  });
}

export function threadApprovers(
  standingOf: StandingOf,
  lookup: ThreadLookup['Service'],
  mandate: ThreadMandate['Service'],
  settings: Settings['Service'],
  delivery: () => ApprovalDelivery | null,
): ApproversPort {
  const parentOf = Effect.fnUntraced(function* (threadId: string) {
    const child = yield* lookup.find(threadId, OPERATOR_PRINCIPAL);
    const parent = child?.parentThreadId == null ? undefined : yield* lookup.find(child.parentThreadId, OPERATOR_PRINCIPAL);
    return parent === undefined || parent.archivedAt != null
      ? ({ approver: null, why: 'no-parent' } as const)
      : ({ approver: parent.id, why: 'parent-owns' } as const);
  });
  const route: ApproversPort['route'] = (threadId, asked) =>
    asked.length > 0 && asked.every((one) => one.parent === true)
      ? parentOf(threadId).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })))
      : Effect.map(standingOf(threadId), ({ approver, why, grant }): ApproverRoute => {
          if (approver === null) return { approver: null, why };
          return grantCovers(grant, asked) ? { approver, why } : { approver: null, why: 'no-grant' };
        }).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
  return {
    route,
    grantOf: Effect.fnUntraced(
      function* (threadId) {
        const thread = yield* lookup.find(threadId, OPERATOR_PRINCIPAL);
        return thread === undefined ? [] : (yield* readApproves(mandate, settings, threadId, thread.projectId)).effective;
      },
      Effect.mapError((cause) => new ThreadCallBroke({ cause })),
    ),
    notify: (approver, notice) => {
      const deliver = delivery();
      if (deliver === null) return Effect.void;
      return Effect.exit(
        deliver(approver, {
          id: notice.id,
          senderThreadId: null,
          intent: 'approval',
          text: noticeText(notice),
        }),
      ).pipe(
        Effect.flatMap((exit) =>
          Exit.isFailure(exit)
            ? Effect.logWarning('an approval question was routed to a parent, but its notice did not land', {
                notice,
                cause: Cause.pretty(exit.cause),
              })
            : Effect.void,
        ),
      );
    },
  };
}
