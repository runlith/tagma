import { Effect } from 'effect';
import { said } from '../../platform/contract/service/presentation.js';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { actChecks, RuleChecks } from '../../enforcement/contract/service/ruleChecks.js';
import { PreparedChanges } from '../../change-record/contract/service/prepared.js';
import { type HeldTaskLabel, HeldTaskLabels } from '../../change-record/contract/service/taskLabels.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { BlockNames } from '../../graph/contract/service/acts.js';
import { HolderStandings } from '../../graph/contract/service/holders.js';
import type { HolderState } from '../../graph/contract/wire/holders.js';
import type { LandedTask, SubmitReceipt, Unrecorded } from '../contract/wire/receipt.js';
import { handoverOf, landingPlace } from '../../change-record/prepared/place.js';
import type { SubmitHandover } from '../../change-record/contract/wire/handover.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { LANDING_OPERATIONS, type SubmitScope } from '../contract/wire/operations.js';
import { CallPlace } from '../../platform/contract/service/place.js';
import { LandingGit } from '../contract/service/servedGit.js';
import { submitWork } from '../land/submit.js';
import { selectCheckout } from '../../change-record/prepared/selection.js';
import { submitLines } from '../voice.js';
import { SignedCall, SignedSession } from '../../platform/contract/service/writers.js';
import { NATIVE_HARNESS, sessionToken } from '../../platform/contract/wire/session.js';
import { completeSubmission, settleSubmission } from '../store/submissions.js';
import { Git } from '@runlith/git/Git';
import { custodianOf } from '../../executions/terminals/principals.js';
import { TerminalRefused } from '../../executions/contract/wire/refusals.js';
import { Settings } from '../../settings/contract/service/values.js';
import { coAuthor } from '../contract/wire/settings.js';

type SubmitOwners =
  | Effect.Services<ReturnType<typeof handoverOf>>
  | Effect.Services<ReturnType<typeof landingPlace>>
  | Effect.Services<ReturnType<typeof submitWork>>
  | Effect.Services<ReturnType<typeof selectCheckout>>
  | CurrentProject
  | LandingGit
  | HeldTaskLabels
  | BlockNames
  | HolderStandings
  | PreparedChanges
  | MachineStore
  | MachineUnits
  | RuleChecks
  | Settings
  | Git;

const NO_STATES: ReadonlyMap<string, HolderState> = new Map();

const known = <A>(
  work: Effect.Effect<A, StoreFailure>,
  missing: A,
  what: string,
): Effect.Effect<{ readonly value: A; readonly unread: readonly Unrecorded[] }> =>
  Effect.match(work, {
    onSuccess: (value) => ({ value, unread: [] }),
    onFailure: (failure) => ({ value: missing, unread: [{ step: 'tasks', reason: `${what}: ${failure.message}` }] }),
  });

const withTasks = Effect.fn('submit_work.tasks')(function* (
  standings: HolderStandings['Service'],
  receipt: SubmitReceipt,
  held: ReadonlyMap<string, readonly HeldTaskLabel[]>,
  own: string | null,
  taken: readonly string[],
  unnamed: readonly string[],
) {
  if (receipt.status !== 'landed') return receipt;
  const mine = own === null ? [] : [own];
  const named = (holders: readonly string[], by: LandedTask['by'], found: ReadonlyMap<string, readonly HeldTaskLabel[]>) =>
    holders.flatMap((holder) => (found.get(holder) ?? []).map((task): LandedTask => ({ name: task.name, title: task.title, holder, by })));
  const others = named(taken, 'taking', held);
  const holders = [...new Set(others.map((task) => task.holder))];
  const states = yield* known(
    holders.length === 0 ? Effect.succeed(NO_STATES) : standings.of(holders),
    NO_STATES,
    `the standing of ${holders.join(', ')}`,
  );
  const tasks = [
    ...named(mine, 'session', held),
    ...others.map((task) => {
      const state = states.value.get(task.holder);
      return state === undefined ? task : { ...task, standing: state.standing };
    }),
  ];
  const unread = states.unread;
  return {
    ...receipt,
    tasks: tasks.length === 0 ? undefined : tasks,
    unnamedTasks: unnamed.length === 0 ? undefined : unnamed,
    unrecorded: unread.length === 0 ? receipt.unrecorded : [...(receipt.unrecorded ?? []), ...unread],
  };
});

export const SUBMIT_PAIRS = {
  submit_work: pair(
    LANDING_OPERATIONS.submit_work,
    body<typeof LANDING_OPERATIONS.submit_work, SubmitScope, SubmitOwners>(LANDING_OPERATIONS.submit_work, {
      place: selectCheckout,
      prepare: Effect.fn('submit_work.prepare')(function* (input, caller: Caller) {
        const call = yield* yield* CurrentProject;
        const place = yield* CallPlace;
        return {
          ...(yield* handoverOf(call.project.id, input.taking ?? [], caller)),
          project: call.project.name,
          checkout: place?.checkout ?? null,
        };
      }),
      execute: Effect.fnUntraced(function* (input, prepared: SubmitHandover, caller: Caller) {
        const call = yield* yield* CurrentProject;
        const place = yield* landingPlace(call.project.id, caller, (yield* LandingGit).run);
        const actor = custodianOf(caller.actor, call.project.id);
        const { taking, refusal } = prepared;
        if (refusal !== null) return yield* refusal;
        const labels = yield* HeldTaskLabels;
        const taken = taking.map((session) => session.threadId);
        const signed = yield* SignedSession;
        const writer = signed !== null && signed.harness !== NATIVE_HARNESS ? signed : undefined;
        const own = place.thread ?? (writer === undefined ? null : sessionToken(writer));
        const holding = yield* labels.forHolders(place.thread === null ? taken : [place.thread, ...taken], writer);
        const heldNames = new Set([...holding.values()].flatMap((tasks) => tasks.map((task) => task.name)));
        const selected = new Set<string>();
        for (const name of input.tasks ?? []) {
          const names = yield* BlockNames;
          const task = yield* names.nameOf(yield* names.idOfName(name));
          if (!heldNames.has(task))
            return yield* new GateRefusal('task-not-held', `${name} is not held by this session or a holder in taking`, [
              'claim the task before submitting its work, or include its holder in taking',
              'remove it from tasks if this commit does not carry its work',
            ]);
          selected.add(task);
        }
        const held = new Map([...holding].map(([holder, tasks]) => [holder, tasks.filter((task) => selected.has(task.name))]));
        const unnamed = input.tasks === undefined && own !== null ? (holding.get(own) ?? []).map((task) => task.name) : [];
        const carried = taking.map((session) => ({
          projectId: session.projectId,
          threadId: session.threadId,
          tasks: held.get(session.threadId) ?? [],
        }));
        const service = yield* PreparedChanges;
        const store = yield* MachineStore;
        const units = yield* MachineUnits;
        const ruleChecks = actChecks(yield* RuleChecks, 'submit_work');
        const submitted = yield* submitWork(
          place.git,
          place.hosted,
          place.root,
          store,
          units,
          place.origin,
          actor instanceof TerminalRefused ? undefined : actor,
          {
            projectId: call.project.id,
            tasks: own === null ? [] : (held.get(own) ?? []),
            taking: carried,
            subject: input.subject,
            body: input.body,
            coAuthored: yield* (yield* Settings).value(coAuthor, call.project.id),
            paths: input.paths,
            whole: input.whole,
            withoutFormat: input.withoutFormat,
          },
          ruleChecks,
          service,
        );
        const receipt = yield* withTasks(yield* HolderStandings, submitted, held, own, taken, unnamed);
        const callId = yield* SignedCall;
        const work = place.origin.work;
        const recorded =
          callId === null || work === null || receipt.status !== 'landed'
            ? receipt
            : yield* completeSubmission(store.db, units, work, callId, receipt).pipe(
                Effect.match({
                  onSuccess: () => receipt,
                  onFailure: (failure) => ({
                    ...receipt,
                    unrecorded: [
                      ...(receipt.unrecorded ?? []),
                      {
                        step: 'receipt' as const,
                        reason: `The commit landed, but its completed call receipt could not be recorded: ${failure.message}`,
                      },
                    ],
                  }),
                }),
              );
        return { status: 'ok' as const, submitted: recorded };
      }),
      settle: settleSubmission,
      voice: said((answer) => submitLines(answer.submitted).join('\n')),
    }),
  ),
};
