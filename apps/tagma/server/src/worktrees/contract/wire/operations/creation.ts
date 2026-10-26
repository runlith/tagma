import { Schema } from 'effect';
import type { ProjectRef } from '../../../../projects/contract/wire/project.js';
import { COVERAGE_REFUSALS, REPOSITORY_REFUSALS, ROOT_REFUSALS } from '../../../../workspace/contract/wire/refusals.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { WORKTREE_READ, WORKTREE_WRITE } from './shape.js';
import {
  ADOPTION_FIELDS,
  OPERATION_ID,
  PREPARATION_FIELDS,
  RELEASE_FIELDS,
  RESOLUTION_FIELDS,
  WorktreeIntent,
  WorktreePreparation,
  WorktreeRecoveryPreparation,
  branchOf,
  refOf,
} from '../creation.js';
import {
  abandonmentSubjects,
  adoptionSubjects,
  creationSubjects,
  operationSubjects as worktreeOperationSubjects,
  reconciliationSubjects,
} from '../subjects.js';
import { resolutionSubjects } from '../../../../workspace/contract/wire/checkoutReads.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { projectField } from '../../../../platform/contract/wire/place.js';

const operationId = OPERATION_ID;

const abandonWorktreeConsequence = (): string =>
  'It releases the destination and the ref this creation holds, and removes nothing: the directory, the branch and any registration git left stand exactly as they are, beside the outcome and its receipt. That receipt is git’s own end and covers the git process this act ran; whatever the repository’s hooks started behind it is the repository’s.';

const modeSentence = (opened: WorktreeIntent): string => {
  const branch = branchOf(opened.mode);
  const ref = refOf(opened.mode);
  const stands =
    opened.mode.kind === 'new-branch'
      ? `new branch ${branch} at ${opened.base}`
      : opened.mode.kind === 'existing-branch'
        ? `existing branch ${branch}`
        : `detached at ${opened.base}`;
  return ref === null ? stands : `${stands} (${ref})`;
};

const WORKTREE_GRAMMAR = `Modes: \`{kind: 'new-branch', branch, start}\` creates the branch at \`start\`, which must resolve to a local commit and whose branch must not exist; \`{kind: 'existing-branch', branch}\` checks out a branch that does exist, and stands where it stands; \`{kind: 'detached', start}\` checks out an object on no branch.
The destination must not exist and its parent must. Both are resolved to the namespace's own spelling, so two spellings of one place are one act.
Preparing writes only the record — and, when no destination is named, the project's worktree folder the checkout will stand in: no ref is taken, no checkout is made, and the same name may be prepared again. The same name carrying a different request refuses.`;

const WORKTREE_FOLDER_SUBJECT = 'worktree:project-folder';

const ACQUIRED = ['environment-unavailable', 'worktree-unavailable'] as const;

const PREPARED_ANSWER = arms({ ok: WorktreePreparation.fields });
const OPERATION_ANSWER = arms({ ok: { operation: WorktreeIntent } });
const RECOVERY_ANSWER = arms({ ok: WorktreeRecoveryPreparation.fields });

export const CREATION_OPERATIONS = {
  prepare_worktree: operation('prepare_worktree', {
    approval: ASKS_IN_REVIEW,
    ...WORKTREE_WRITE,
    meaning:
      'Resolve what a worktree creation would be — its store, destination, ref and base object — and open the operation record its approval is spent on.',
    grammar: `${WORKTREE_GRAMMAR}
Answers the permission subjects — namespace, repository, destination, ref — beside the record. Approving them is a separate road; nothing is created here.`,
    answer: PREPARED_ANSWER,
    input: Schema.Struct({ project: projectField, ...PREPARATION_FIELDS }),
    refusals: [
      'changed-payload',
      'relative-path',
      'parent-missing',
      'destination-occupied',
      'ref-occupied',
      'ref-missing',
      'base-absent',
      'foreign-namespace',
      'foreign-environment',
      ...ACQUIRED,
      ...REPOSITORY_REFUSALS,
      ...COVERAGE_REFUSALS,
      ...ROOT_REFUSALS,
    ],
    subjects: (input) =>
      input.destination === undefined
        ? [{ kind: 'write' as const, value: WORKTREE_FOLDER_SUBJECT }]
        : resolutionSubjects(input.destination),
    confirmation: (input, project: ProjectRef) => ({
      summary: `Open the worktree creation ${input.operationId} for project “${project.name}”, to stand at ${input.destination ?? 'its worktree folder'}?`,
      facts: [
        {
          label: 'Store',
          value: `${input.repository.repositoryId} at revision ${input.repository.locationRevision}`,
        },
      ],
      consequence:
        'It resolves the store, the destination, the ref and the base object and records them under this name. No ref is taken and no directory is made; the name is bound until the act it opens is resolved.',
    }),
    confirmLabel: 'Prepare',
    presentation: {
      running: 'Preparing a worktree',
      done: 'Prepared a worktree',
    },
  }),
  create_worktree: operation('create_worktree', {
    approval: ASKS_IN_REVIEW,
    ...WORKTREE_WRITE,
    meaning:
      'Run a prepared worktree creation: reserve its name and ref, then make the checkout under normal Git configuration. The calling thread keeps standing where it stood; move_thread stands it in the new checkout.',
    answer: OPERATION_ANSWER,
    grammar: `Git runs with the repository's own configuration, hooks and filters, and with no force, no fetch and no checkout in the caller's tree.
An operation whose outcome is already recorded is answered, never run again, so a duplicate delivery makes no second checkout. The store, the base object, the destination and the ref are all read AGAIN before anything is reserved, so a store that moved or was replaced, a base that is gone, and a destination or branch somebody took between the two phases each refuse with the record left exactly as prepared.
A new branch or a detached checkout of a project whose graph is stored in the tree starts with the graph its base checkout holds now: the graph is first delivered there under \`graph.commit\`, and the base object advances to the delivered head only across commits that change nothing but the graph, so the code stays the approved base. Under \`graph.commit = off\` nothing is committed: the checkout starts from the prepared base, and \`evidence.graphLeft\` names the base checkout and how many uncommitted graph files stayed there.
A refusal git reached with nothing left behind answers \`failed\`. Anything else answers \`uncertain\`: a destination that stands, and also a destination that does not while the store still holds this act's branch or a registration of it — a checkout hook that removes what it made leaves exactly that. Nothing is ever removed, and an \`uncertain\` operation holds its destination and its ref until a recovery takes it or a release declares it finished with.`,
    input: Schema.Struct({ project: projectField, operationId }),
    refusals: [
      'destination-reserved',
      'ref-reserved',
      'destination-occupied',
      'ref-occupied',
      'ref-missing',
      'base-absent',
      'stale-revision',
      'foreign-namespace',
      'foreign-environment',
      'foreign-project',
      'not-found',
      ...ACQUIRED,
      ...REPOSITORY_REFUSALS,
      ...COVERAGE_REFUSALS,
      ...ROOT_REFUSALS,
    ],
    subjects: (_input, prepared) => creationSubjects(prepared),
    confirmation: (_input, prepared) => ({
      summary: `Make a checkout at ${prepared.destination} on ${modeSentence(prepared)}?`,
      facts: [
        {
          label: 'Store',
          value: `${prepared.repository.repositoryId} at revision ${prepared.repository.locationRevision}`,
        },
        { label: 'Base object', value: prepared.base },
      ],
      consequence:
        'Git runs with the repository’s own configuration, hooks and filters, and whatever the run leaves stands where it is: nothing is ever removed. A run that ends unresolved keeps holding this name and this ref until a recovery takes the checkout or an abandonment declares the act finished with; a run that reached nothing holds nothing.',
    }),
    confirmLabel: 'Create',
    presentation: {
      running: 'Creating a worktree',
      done: 'Created a worktree',
    },
  }),
  read_worktree_operation: operation('read_worktree_operation', {
    approval: ASKS_NEVER,
    ...WORKTREE_READ,
    meaning: 'Read how far one worktree creation got and what was observed of it, without replaying anything.',
    answer: OPERATION_ANSWER,
    grammar:
      'Answers pending, ready, failed or uncertain, and the registered root once there is one. A receipt — the command that ran, git\u2019s status and message, what the filesystem said about the destination and what the store still held — rides along where this server saw the run END; an operation reserved without one is an act whose end nobody observed, which is never proof that git did not run. It asks git nothing and touches no directory. An operation prepared under another project is refused rather than read: an id travels, and a receipt is not a thing another project\u2019s caller may see.',
    input: Schema.Struct({ project: projectField, operationId }),
    refusals: ['not-found', 'foreign-project', 'worktree-unavailable'],
    subjects: (input) => worktreeOperationSubjects(input.operationId),
    confirmation: (input) => ({ summary: `Read worktree operation ${input.operationId}?` }),
    confirmLabel: 'Read operation',
    presentation: {
      running: 'Reading a worktree operation',
      done: 'Read a worktree operation',
      many: (count) => `Read ${count} worktree operations`,
    },
  }),
  prepare_worktree_recovery: operation('prepare_worktree_recovery', {
    approval: ASKS_NEVER,
    ...WORKTREE_READ,
    meaning:
      'Resolve what taking an observed checkout would be for one unresolved creation, and answer its subjects and the target exactly as found.',
    grammar:
      'Answers the subjects an approval is over, the observed target — its canonical place, the object standing there and its own git directory — and the operation at the revision those facts were read at. It writes nothing, so a caller may resolve a recovery it never takes. What it answers is what the taking act is given back and checks, so an approval binds to a thing rather than to a path.',
    answer: RECOVERY_ANSWER,
    input: Schema.Struct({ project: projectField, ...RESOLUTION_FIELDS }),
    refusals: [
      'settled',
      'unreserved',
      'abandoned',
      'observed-mismatch',
      'foreign-namespace',
      'foreign-environment',
      'foreign-project',
      'not-found',
      ...ACQUIRED,
      ...REPOSITORY_REFUSALS,
    ],
    subjects: (input) => resolutionSubjects(input.observed),
    confirmation: (input) => ({
      summary: `Resolve recovery of ${input.operationId} from ${input.observed}?`,
    }),
    confirmLabel: 'Resolve recovery',
    presentation: {
      running: 'Preparing worktree recovery',
      done: 'Prepared worktree recovery',
    },
  }),
  abandon_worktree: operation('abandon_worktree', {
    approval: ASKS_IN_REVIEW,
    ...WORKTREE_WRITE,
    meaning: 'Declare one unresolved creation finished with, releasing the destination and the ref it holds and removing nothing.',
    answer: OPERATION_ANSWER,
    grammar: `No directory, ref or worktree registration is touched, and the outcome and its receipt stand exactly as they were: the reason is recorded beside them, and the operation is over — never run, resolved or adopted again.
It is legal only where a receipt stands, and a receipt is one exact fact: this server saw GIT end — its own exit status — or the spawn was proved to have refused, so no child of the act ever existed. That is the end of the git process this creation ran, and it is the whole of what a receipt carries: a hook the repository ran behind git may have left a descendant of its own writing in that directory, and so may anything else on this machine. What is released is therefore the NAME and the ref, which is what this server holds; the bytes are the repository's. A creation with no receipt is one whose end nobody here observed at all, and it refuses \`unreconciled\` until something reconciles it — uncertainty is never a permission to free a name a live checkout may still be writing into.`,
    input: Schema.Struct({ project: projectField, ...RELEASE_FIELDS }),
    refusals: [
      'settled',
      'unreconciled',
      'stale-revision',
      'foreign-namespace',
      'foreign-environment',
      'foreign-project',
      'not-found',
      ...ACQUIRED,
    ],
    subjects: (_input, prepared) => abandonmentSubjects(prepared),
    confirmation: (input, prepared) => ({
      summary: `Release ${prepared.destination}${refOf(prepared.mode) === null ? '' : ` and ${refOf(prepared.mode)}`}, declaring ${input.operationId} finished with?`,
      facts: [
        { label: 'Reason', value: input.reason },
        { label: 'Outcome it stands at', value: `${prepared.status} at revision ${prepared.revision}` },
      ],
      consequence: abandonWorktreeConsequence(),
    }),
    confirmLabel: 'Abandon',
    intent: 'destructive',
    destructiveConsequence: abandonWorktreeConsequence,
    presentation: {
      running: 'Abandoning a worktree',
      done: 'Abandoned a worktree',
    },
  }),
  reconcile_worktree: operation('reconcile_worktree', {
    approval: ASKS_IN_REVIEW,
    ...WORKTREE_WRITE,
    meaning: 'Establish that the installation which authorized an unresolved creation is not this one, and record what it left.',
    grammar: `An act reserved with no receipt is one whose end nobody here observed, and it holds its destination and its ref until something resolves it. Two of the three ways that happens settle themselves — a run this server interrupted records \`terminated\`, one it could not read records \`lost\` — and this is the third: a producer killed without unwinding, which wrote nothing at all.
It is legal only where the operation's producer is NOT this installation, because that is the whole of what makes the reading sound: an installation that is not running here is provably not writing here, while a probe of this one cannot tell a live run from a dead one and refuses \`unreconciled\` instead.
It writes a receipt from what the destination and the store say NOW, so the act becomes releasable. It deletes nothing, takes no checkout and registers no root; a creation that already carries a receipt or an abandonment is answered as it stands, so repeating it is the same act.`,
    answer: OPERATION_ANSWER,
    input: Schema.Struct({ project: projectField, operationId }),
    refusals: [
      'unreconciled',
      'settled',
      'foreign-namespace',
      'foreign-environment',
      'foreign-project',
      'not-found',
      ...ACQUIRED,
      ...REPOSITORY_REFUSALS,
      ...COVERAGE_REFUSALS,
      ...ROOT_REFUSALS,
    ],
    subjects: (_input, prepared) => reconciliationSubjects(prepared),
    confirmation: (input, prepared) => ({
      summary: `Establish what ${input.operationId} left at ${prepared.destination}?`,
      facts: [
        { label: 'Authorized by', value: prepared.producer ?? 'no producer recorded' },
        {
          label: 'Which is not',
          value: 'this installation — the server compared the two and they differ',
        },
        { label: 'Ref it holds', value: refOf(prepared.mode) ?? 'none' },
        { label: 'Standing at', value: `${prepared.status} @ ${prepared.revision}` },
      ],
      consequence:
        "It records what the destination and the store say now, so the act becomes releasable. Nothing is deleted, no checkout is taken and no root is registered. It is legal only because the installation that authorized this run is not this one, which is what makes it provably not writing THROUGH THIS SERVER. That is the whole of what the receipt proves: this server's own reading of the destination and the store, and the producer identity it compared. It does not prove that nothing is writing there — a descendant the dead producer left behind, a hook's child, an operator's own shell, none of those are visible to it, and none are settled by it.",
    }),
    confirmLabel: 'Reconcile',
    presentation: {
      running: 'Reconciling a worktree',
      done: 'Reconciled a worktree',
    },
  }),
  adopt_worktree: operation('adopt_worktree', {
    approval: ASKS_IN_REVIEW,
    ...WORKTREE_WRITE,
    meaning: 'Take the checkout an authorized creation may have left, spending a resolution over the target that resolution named.',
    answer: OPERATION_ANSWER,
    grammar: `\`observed\` is the target the resolution answered and the approval was OVER — carry it through the approval and hand back exactly it, because a caller that re-derives its own reading approves nothing about the target.
The observed directory is proved by readings, not trusted and never registered: it must canonically be the destination that operation reserved, must still be the object the resolution identified, git must read it as a checkout rooted there, and its objects must be in the store this operation was prepared against — read again here exactly as an execution reads it. The store's own main worktree is not a checkout any creation made and is refused. The reservation then retires into a registered root in one unit with the operation's own resolution, so a stale recovery registers nothing; the receipt of the run nobody saw end is kept unchanged, so a recovered creation stays readable as one.
Repeating it answers the resolution the first one reached. A creation that reached nothing, or that was never authorized, has no checkout to take. Bytes are never moved, written or removed.`,
    input: Schema.Struct({ project: projectField, ...ADOPTION_FIELDS }),
    refusals: [
      'settled',
      'unreserved',
      'abandoned',
      'stale-revision',
      'observed-mismatch',
      'observed-changed',
      'foreign-namespace',
      'foreign-environment',
      'foreign-project',
      'not-found',
      ...ACQUIRED,
      ...REPOSITORY_REFUSALS,
      ...ROOT_REFUSALS,
      'destination-reserved',
    ],
    subjects: (_input, prepared) => adoptionSubjects(prepared),
    confirmation: (input, prepared) => ({
      summary: `Take the checkout at ${input.observed.path} as the result of ${input.operationId}?`,
      facts: [
        { label: 'Reserved destination', value: prepared.destination },
        { label: 'Ref it holds', value: refOf(prepared.mode) ?? 'none' },
        { label: 'Read at revision', value: String(input.revision) },
      ],
      consequence:
        'It registers that directory as a root and resolves the creation. Bytes are never moved, written or removed, and a place holding another object than the resolution identified refuses.',
    }),
    confirmLabel: 'Adopt',
    presentation: {
      running: 'Adopting a worktree',
      done: 'Adopted a worktree',
    },
  }),
};

export type CreationOperationId = keyof typeof CREATION_OPERATIONS;
export const CREATION_OPERATION_IDS = Object.keys(CREATION_OPERATIONS) as readonly CreationOperationId[];
