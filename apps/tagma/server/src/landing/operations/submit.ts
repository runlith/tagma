import { Effect } from 'effect';
import { said } from '../../platform/contract/service/presentation.js';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { actChecks, RuleChecks } from '../../enforcement/contract/service/ruleChecks.js';
import { PreparedChanges } from '../../change-record/contract/service/prepared.js';
import { type HeldTaskLabel, HeldTaskLabels } from '../../change-record/contract/service/taskLabels.js';
import { OPERATOR, holderKey } from '../../workspace/contract/wire/checkout.js';
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
import { SignedCall } from '../../platform/contract/service/writers.js';
import { completeSubmission, settleSubmission } from '../store/submissions.js';
import { Git } from '@runlith/git/Git';
import { custodianOf } from '../../executions/terminals/principals.js';
import { TerminalRefused } from '../../executions/contract/wire/refusals.js';

type SubmitOwners =
  | Effect.Services<ReturnType<typeof handoverOf>>
  | Effect.Services<ReturnType<typeof landingPlace>>
  | Effect.Services<ReturnType<typeof submitWork>>
  | Effect.Services<ReturnType<typeof selectCheckout>>
  | CurrentProject
  | LandingGit
  | HeldTaskLabels
  | HolderStandings
  | PreparedChanges
  | MachineStore
  | MachineUnits
  | RuleChecks
  | Git;

const OPERATOR_KEY = holderKey(OPERATOR);
const NO_TASKS: ReadonlyMap<string, readonly HeldTaskLabel[]> = new Map();
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
  labels: HeldTaskLabels['Service'],
  standings: HolderStandings['Service'],
  receipt: SubmitReceipt,
  held: ReadonlyMap<string, readonly HeldTaskLabel[]>,
  own: string | null,
  taken: readonly string[],
) {
  if (receipt.status !== 'landed') return receipt;
  const mine = own === null ? [] : [own];
  const asked = new Set([...mine, ...taken]);
  const peers = [...new Set(receipt.carried.flatMap((one) => one.holders))].filter(
    (holder) => holder !== OPERATOR_KEY && !asked.has(holder),
  );
  const read = yield* known(
    peers.length === 0 ? Effect.succeed(NO_TASKS) : labels.forHolders(peers),
    NO_TASKS,
    `the tasks of ${peers.join(', ')}`,
  );
  const named = (holders: readonly string[], by: LandedTask['by'], found: ReadonlyMap<string, readonly HeldTaskLabel[]>) =>
    holders.flatMap((holder) => (found.get(holder) ?? []).map((task): LandedTask => ({ name: task.name, title: task.title, holder, by })));
  const others = [...named(taken, 'taking', held), ...named(peers, 'carried', read.value)];
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
  const unread = [...read.unread, ...states.unread];
  return {
    ...receipt,
    tasks: tasks.length === 0 ? undefined : tasks,
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
        const held = yield* labels.forHolders(place.thread === null ? taken : [place.thread, ...taken]);
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
            tasks: place.thread === null ? [] : (held.get(place.thread) ?? []),
            taking: carried,
            subject: input.subject,
            paths: input.paths,
            whole: input.whole,
            withoutFormat: input.withoutFormat,
          },
          ruleChecks,
          service,
        );
        const receipt = yield* withTasks(labels, yield* HolderStandings, submitted, held, place.thread, taken);
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
