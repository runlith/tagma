import { Context, Effect } from 'effect';
import type { CommentPolicy } from '@runlith/source-comments';
import type { CommandTimes } from '@runlith/agent-tools/CommandWork';
import type { World } from '@runlith/agent-tools/world';
import { sweepProse } from '@runlith/agent-tools/sweepProse';
import type { Git } from '@runlith/git/Git';
import type { RunAdmission } from '@runlith/agent/thread/run/runAdmission';
import type { Caller } from '../platform/contract/wire/caller.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { MachineStore, StoreFailure } from '../platform/contract/service/store.js';
import { CallerChangeWork, type ChangeRecord } from '../change-record/contract/service/record.js';
import { StripComments, type StripCommentsRequest } from '../change-record/contract/service/sweep.js';
import type { StripCommentsContext } from '../change-record/sweep/stripComments.js';
import { changeRecord } from '../change-record/change-record.js';
import type { SandboxFiles } from '../sandbox/contract/service/files.js';
import { GuestFileReader, ImportDestination } from '../sandbox/contract/service/imports.js';
import { sandbox } from '../sandbox/sandbox.js';
import { namesOfHolders } from '../change-record/record/sessions.js';
import { commandTimes, toolTimes } from '../executions/commands/times.js';
import { commentPolicy } from '../graph/settings.js';
import { CHECKOUT_DIRECTORY } from '../graph/contract/wire/storage.js';
import type { Settings } from '../settings/contract/service/values.js';
import type { CallerWorkspace } from '../workspace/contract/service/places.js';
import type { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import { checkoutSettingAt, governingProject } from '../workspace/governing.js';
import type { WorkingOrigin } from '../workspace/contract/wire/place.js';
import type { ThreadStanding } from '../invocation/contract/service/admission.js';
import type { ServingGit } from '../executions/contract/service/git.js';
import { executions } from '../executions/executions.js';

export type ThreadWork = {
  readonly thread: { readonly id: string; readonly ownerId: string; readonly projectId: number };
  readonly projectRoot: string;
  readonly place: { readonly root: string; readonly origin: WorkingOrigin | null };
  readonly world: World;
  readonly runId: string | null;
  readonly comments: (target: string) => Effect.Effect<CommentPolicy, Error>;
  readonly times: CommandTimes;
};

export type WorkLifetimes = {
  readonly machine: Context.Service.Shape<typeof MachineStore>;
  readonly changes: ChangeRecord['Service'];
  readonly files: SandboxFiles['Service'];
  readonly git: Git['Service'];
  readonly admission: Context.Service.Shape<typeof RunAdmission>;
};

export type WorkOwners = StripComments;

const unworked = Context.make(CallerChangeWork, null).pipe(
  Context.add(StripComments, {
    strip: () =>
      Effect.fail(
        new GateRefusal('record-unread', 'This call carries no thread working in a checkout, so no change record takes the sweep.', [
          'Run the sweep from a thread working in the checkout.',
        ]),
      ),
  }),
  Context.add(GuestFileReader, null),
  Context.add(ImportDestination, null),
);

export const workOwners = (lifetimes: WorkLifetimes, work: ThreadWork | null): Context.Context<WorkOwners> => {
  if (work === null) return unworked;
  const { thread, place } = work;
  const at = { projectId: thread.projectId, threadId: thread.id };
  const changes = lifetimes.changes.changes({ work: at, runHint: work.runId ?? undefined });
  const times = toolTimes(work.times);
  const sweep = (request: StripCommentsRequest): StripCommentsContext => ({
    git: lifetimes.git,
    machine: lifetimes.machine,
    sessionNames: (threadIds) => namesOfHolders(lifetimes.machine, threadIds),
    threadId: request.threadId,
    root: request.root,
    graphDirectory: CHECKOUT_DIRECTORY,
    checkout: request.checkout,
    sweepProse: (paths) => sweepProse({ cwd: place.root, world: work.world, changes, unowned: [CHECKOUT_DIRECTORY], ...times }, paths),
  });
  const recorded = changeRecord.lifetimes.call({ work: { work: at }, sweep });
  const imported = sandbox.lifetimes.call({
    source: {
      files: lifetimes.files,
      machine: lifetimes.machine,
      admission: lifetimes.admission,
      projectId: thread.projectId,
      ownerId: thread.ownerId,
      threadId: thread.id,
    },
    destination: {
      cwd: place.root,
      allowOutsideCwd: true,
      world: work.world,
      changes,
      comments: work.comments,
      unowned: [CHECKOUT_DIRECTORY],
      ...times,
    },
  });
  return Context.merge(recorded, imported);
};

export const threadWorkOf = (
  machine: Context.Service.Shape<typeof MachineStore>,
  settings: Context.Service.Shape<typeof Settings>,
  paths: CheckoutPaths['Service'],
) =>
  Effect.fn('invocation.threadWork')(function* (
    caller: Caller,
    place: CallerWorkspace['Service'],
    standing: ThreadStanding | null,
  ): Effect.fn.Return<ThreadWork | null, StoreFailure | GateRefusal> {
    const actor = caller.actor;
    if (actor.kind !== 'thread' || place === null || standing === null) return null;
    const locate = standing.world.facts.shared ? (at: string) => paths.resourceAcross(at) : null;
    const governing = governingProject(locate, actor.projectId);
    return {
      thread: { id: actor.threadId, ownerId: actor.principalId, projectId: actor.projectId },
      projectRoot: standing.projectRoot,
      place,
      world: standing.world.world,
      runId: standing.runId,
      comments: checkoutSettingAt(
        settings,
        locate,
        commentPolicy,
        { projectId: actor.projectId, value: yield* settings.held(commentPolicy, actor.projectId) },
        'allowed',
      ),
      times: commandTimes(machine, actor.projectId, governing),
    };
  });

export type CallLifetimes = WorkLifetimes & {
  readonly settings: Context.Service.Shape<typeof Settings>;
  readonly paths: CheckoutPaths['Service'];
  readonly servingGit: ServingGit['Service'];
};

export const callOwnersOf = (lifetimes: CallLifetimes) => {
  const workOf = threadWorkOf(lifetimes.machine, lifetimes.settings, lifetimes.paths);
  return Effect.fn('invocation.callOwners')(function* (
    caller: Caller,
    place: CallerWorkspace['Service'],
    standing: ThreadStanding | null,
  ): Effect.fn.Return<Context.Context<WorkOwners>, StoreFailure | GateRefusal> {
    const worked = workOwners(lifetimes, yield* workOf(caller, place, standing));
    return standing === null
      ? worked
      : Context.merge(
          worked,
          executions.lifetimes.call({ servingGit: lifetimes.servingGit, world: standing.world, runId: standing.runId }),
        );
  });
};
