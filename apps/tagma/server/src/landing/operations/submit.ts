import { Effect } from 'effect';
import { said } from '../../platform/contract/service/presentation.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { actChecks, RuleChecks } from '../../enforcement/contract/service/ruleChecks.js';
import { PreparedChanges } from '../../change-record/contract/service/prepared.js';
import { type HeldTaskLabel, HeldTaskLabels } from '../../change-record/contract/service/taskLabels.js';
import { blockLabel } from '../../graph/blockLabels.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { landingPlace } from '../../change-record/prepared/place.js';
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
import { checkoutMode } from '../../graph/settings.js';
import { coAuthor } from '../contract/wire/settings.js';

type SubmitOwners =
  | Effect.Services<ReturnType<typeof landingPlace>>
  | Effect.Services<ReturnType<typeof submitWork>>
  | Effect.Services<ReturnType<typeof selectCheckout>>
  | CurrentProject
  | LandingGit
  | HeldTaskLabels
  | Effect.Services<ReturnType<typeof blockLabel>>
  | PreparedChanges
  | MachineStore
  | MachineUnits
  | RuleChecks
  | Settings
  | Git;

const declared = Effect.fn('submit_work.tasks')(function* (names: readonly string[]) {
  const found = new Map<string, HeldTaskLabel>();
  for (const name of names) {
    const label = yield* blockLabel(name);
    if (!label.work)
      return yield* new GateRefusal('not-work', `${name} is no work a commit can carry: tasks names blocks whose tags make them work`, [
        'remove it from tasks, or name the task whose work this commit carries',
      ]);
    found.set(label.name, { name: label.name, title: label.title, stealth: label.stealth });
  }
  return [...found.values()];
});

export const SUBMIT_PAIRS = {
  submit_work: pair(
    LANDING_OPERATIONS.submit_work,
    body<typeof LANDING_OPERATIONS.submit_work, SubmitScope, SubmitOwners>(LANDING_OPERATIONS.submit_work, {
      place: selectCheckout,
      prepare: Effect.fn('submit_work.prepare')(function* () {
        const call = yield* yield* CurrentProject;
        const place = yield* CallPlace;
        return { project: call.project.name, checkout: place?.checkout ?? null };
      }),
      execute: Effect.fnUntraced(function* (input, _prepared: SubmitScope, caller: Caller) {
        const call = yield* yield* CurrentProject;
        const place = yield* landingPlace(call.project.id, caller, (yield* LandingGit).run);
        const actor = custodianOf(caller.actor, call.project.id);
        const tasks = yield* declared(input.tasks ?? []);
        const signed = yield* SignedSession;
        const writer = signed !== null && signed.harness !== NATIVE_HARNESS ? signed : undefined;
        const own = place.thread ?? (writer === undefined ? null : sessionToken(writer));
        const unnamed =
          input.tasks !== undefined || own === null
            ? []
            : ((yield* (yield* HeldTaskLabels).forHolders(place.thread === null ? [] : [place.thread], writer)).get(own) ?? []).map(
                (task) => task.name,
              );
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
            tasks,
            subject: input.subject,
            body: input.body,
            coAuthored: yield* (yield* Settings).value(coAuthor, call.project.id),
            paths: input.paths,
            everything: (yield* (yield* Settings).value(checkoutMode, call.project.id)) === 'single',
            derive: input.derive,
            withoutFormat: input.withoutFormat,
          },
          ruleChecks,
          yield* PreparedChanges,
        );
        const receipt =
          submitted.status !== 'landed'
            ? submitted
            : {
                ...submitted,
                tasks: tasks.length === 0 ? undefined : tasks.map((task) => ({ name: task.name, title: task.title })),
                unnamedTasks: unnamed.length === 0 ? undefined : unnamed,
              };
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
