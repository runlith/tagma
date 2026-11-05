import { Schema } from 'effect';
import { COVERAGE_REFUSALS, REPOSITORY_REFUSALS, ROOT_REFUSALS } from '../../../../workspace/contract/wire/refusals.js';
import { GIT_REFUSALS } from '../../../../platform/contract/wire/refusal.js';
import { limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { WORKTREE_READ, WORKTREE_WRITE } from './shape.js';
import { CLEANUP_IDLE_DAYS, WorktreeCleanupAnswer, WorktreesCleaned } from '../cleanup.js';
import { RootId } from '../../../../workspace/contract/wire/ids.js';
import { RenameRemote, WorktreeRenamed } from '../creation.js';
import { WorktreeDeleted } from '../retirement.js';
import type { FinishingPlace } from '../mergeTypes.js';
import { checkoutActSubjects } from '../../../../workspace/contract/wire/checkoutActs.js';
import { WORKTREE_CLEANUP } from '../pages.js';
import { AGENT_RUNNING, ROOT_IN_USE } from '../../../../platform/contract/wire/conditions.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import type { Condition, Raised } from '@runlith/agent/permissions';
import { placeRole, placedCursor, projectField } from '../../../../platform/contract/wire/place.js';

export const FOLDER_DIRTY: Condition = { id: 'folder-dirty', label: 'Uncommitted files', asksFrom: 'trust', timeout: 'none' };

const worktreeId = RootId.annotate(placeRole('worktree'));

export const rootId = worktreeId.annotate({ description: 'The worktree, by the `rootId` its row in list_worktrees answers.' });

export const PLACE = [
  'not-found',
  'worktree-unavailable',
  ...ROOT_REFUSALS,
  'destination-reserved',
  'finishing-busy',
  'finishing-cut',
] as const;

const LISTING = ['worktree-unavailable', ...ROOT_REFUSALS, ...COVERAGE_REFUSALS, ...REPOSITORY_REFUSALS] as const;

const DELETE = [
  ...PLACE,
  'own-worktree',
  'root-in-use',
  'operation-in-progress',
  ...COVERAGE_REFUSALS,
  ...REPOSITORY_REFUSALS,
  ...GIT_REFUSALS,
] as const;

const CLEANUP = [...new Set([...LISTING, 'not-a-candidate', 'blocked', ...DELETE])];

export const subjects = (_input: unknown, prepared?: FinishingPlace | null) =>
  prepared == null ? [] : [...checkoutActSubjects(prepared.folder), ...(prepared.base === null ? [] : checkoutActSubjects(prepared.base))];

export const raised = (_input: unknown, prepared?: FinishingPlace | null): readonly Raised[] => prepared?.consents ?? [];

export const deleteConsequence = (): string =>
  'Uncommitted work is committed onto the branch first. The folder with everything in it, the worktree record and its merge checks go, and its threads are archived. The branch goes too unless merging it would change something in its base besides the graph; then it stays and the answer lists its commits.';

export const ENDING_GRAMMAR = `Agents still running in the worktree are stopped, and every terminal and command still holding it is stopped too, each under its own key \`worktree-end:<rootId>:<execution>\`; the act waits for their discharge up to the stop ladder's span plus one watcher round, and \`ended\` in the answer names what it ended. An agent's call that would stop them asks the operator first under review. Anything started outside the worktree that still holds it, whose stop is refused, or that a caller bound to no project cannot reach refuses \`root-in-use\` naming its holder before anything is stopped; anything still holding after the wait refuses \`root-in-use\` naming the stop's key. The worktree the calling thread stands in refuses \`own-worktree\` in every mode.`;

const RENAMED_ANSWER = arms({ renamed: WorktreeRenamed.fields });
const DELETED_ANSWER = arms({ deleted: WorktreeDeleted.fields, 'branch-kept': WorktreeDeleted.fields });
const CLEANUP_LIST_ANSWER = arms({ ok: { cleanup: WorktreeCleanupAnswer } });
const CLEANED_ANSWER = arms({ cleaned: WorktreesCleaned.fields });

export const RETIREMENT_OPERATIONS = {
  rename_worktree: operation('rename_worktree', {
    approval: ASKS_IN_REVIEW,
    ...WORKTREE_WRITE,
    answer: RENAMED_ANSWER,
    meaning: "Rename a worktree's branch, with its graph twin, and keep the remote branch and an open GitHub pull request honest.",
    grammar: `The name is spelled as a git branch: spaces become dashes and the project's branch prefix is kept. The folder keeps its name, because running terminals and agents' histories are keyed by its path. A taken name refuses \`name-taken\`, one git refuses as a branch name \`name-invalid\`, and a name the branch already has \`name-unchanged\`. A worktree renamed here is never renamed after its thread's title again.
The local rename lands first; the remote answers beside it:
- \`unpublished\` — the branch tracked nothing, so nothing moved on a remote.
- \`moved\` — the new name was pushed and the upstream points at it; the old remote branch is deleted only where Tagma made the branch, this repository pushed it first and the new name holds its tip (\`old\` says what happened).
- \`kept\` — the remote keeps the old name and Tagma's own pushes of this branch go there: the remote is not GitHub, gh cannot answer for it, a step failed, or a pull request stays open because \`remote\` was \`keep\`.
With an open GitHub pull request, \`remote: move\` pushes the new name, opens a new pull request with the old one's title, body and base, closes the old one with a comment linking the new one, then deletes the old remote branch. GitHub's own branch rename is not used: it closes a pull request whose head branch it renames.`,
    input: Schema.Struct({
      rootId,
      name: Schema.NonEmptyString.annotate({
        description: 'The new branch name; the project’s branch prefix is added when it is missing.',
      }),
      remote: Schema.optional(
        RenameRemote.annotate({
          description:
            'With an open GitHub pull request: keep (default) leaves it on the old remote name; move opens a new one under the new name and closes the old.',
        }),
      ),
    }),
    refusals: [...PLACE, 'folder-missing', 'no-branch', 'name-invalid', 'name-taken', 'name-unchanged', 'off-branch', ...GIT_REFUSALS],
    subjects,
    raises: raised,
    confirmation: (input, prepared?: FinishingPlace | null) => ({
      summary: `Rename the branch of ${prepared?.folder ?? input.rootId} to ${input.name}?`,
      consequence:
        input.remote === 'move'
          ? 'Where a GitHub pull request is open, a new one is opened under the new name and the old one is closed.'
          : 'The folder keeps its name; a pushed branch without an open pull request moves to the new name on its remote.',
    }),
    confirmLabel: 'Rename',
    presentation: {
      running: 'Renaming a worktree',
      done: 'Renamed a worktree',
    },
  }),
  delete_worktree: operation('delete_worktree', {
    approval: { ...ASKS_IN_REVIEW, when: [AGENT_RUNNING, ROOT_IN_USE, FOLDER_DIRTY] },
    ...WORKTREE_WRITE,
    external: true,
    answer: DELETED_ANSWER,
    meaning: 'Delete a worktree completely, preserving unfinished work on its branch and archiving its threads.',
    grammar: `The graph commits its own tree first and stops writing into the folder; where it cannot, its files are leftovers like any other. Uncommitted and untracked paths are then committed onto the branch, naming the threads whose lines they carry, except the \`.merge_file_*\` files a merge check left and the file watcher's \`.watch-cookie-*\` markers; \`committed\` names that commit. The folder goes with everything in it, ignored files included, whatever it holds: no file refuses the act, and a folder already gone is no obstacle. A branch Tagma created is deleted when merging it would change nothing in its base outside Tagma's graph; otherwise it stays as a plain git branch, \`branch.commits\` naming up to 50 of its commits other than graph commits. A branch Tagma did not create stays, and a worktree on no branch keeps that commit on a new branch \`tagma/kept/<name>-<commit>\`. Then the threads standing there are archived — one that cannot be is named under \`threads.kept\` — and the worktree record, its merge checks and any waiting merge go. A git operation in progress in the worktree refuses \`operation-in-progress\`. Uncommitted paths raise \`folder-dirty\`, which asks the operator in trust and review. An app process is asked nothing and stops no terminal or command: whatever still holds the worktree refuses \`root-in-use\`.
${ENDING_GRAMMAR}`,
    input: Schema.Struct({ rootId }),
    refusals: DELETE,
    subjects,
    raises: raised,
    confirmation: (input, prepared?: FinishingPlace | null) => ({
      summary: `Delete worktree ${prepared?.folder ?? input.rootId}?`,
      consequence: deleteConsequence(),
    }),
    confirmLabel: 'Delete',
    presentation: {
      running: 'Deleting a worktree',
      done: 'Deleted a worktree',
    },
  }),
  list_worktree_cleanup: operation('list_worktree_cleanup', {
    approval: ASKS_NEVER,
    ...WORKTREE_READ,
    answer: CLEANUP_LIST_ANSWER,
    meaning:
      "Read which of this project's worktrees can be cleaned up — merged, missing, or idle for long enough — each with its reason and what blocks it.",
    grammar: `Only worktrees Tagma made are candidates. \`reason\` is \`merged\` where the branch holds nothing its base lacks, \`missing\` where the folder is gone, \`idle\` where no thread moved in it and its branch took no commit for \`idleAfterDays\` whole days (${CLEANUP_IDLE_DAYS} when omitted). \`blockers\` names what stops clean_up_worktrees from taking it: an agent running or waiting there, uncommitted paths, commits on its branch that neither a remote nor its base branch carries, a branch git could not read (\`unread\`), a merge waiting on it. Merged candidates come first, then missing, then idle, and within each the longest still first. The page's \`limit\` defaults to the whole set up to the family's measured ceiling, because a cleanup is judged over every candidate.`,
    input: Schema.Struct({
      project: projectField,
      idleAfterDays: Schema.optional(
        Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
          description: `Whole days without movement that make a worktree idle. Omitted: ${CLEANUP_IDLE_DAYS}.`,
        }),
      ),
      limit: limitOf(WORKTREE_CLEANUP),
      cursor: placedCursor,
    }),
    refusals: ['bad-cursor', 'cursor-stale', ...LISTING],
    subjects: () => [],
    confirmation: () => ({ summary: "Read which of this project's worktrees can be cleaned up?" }),
    confirmLabel: 'Read cleanup candidates',
    presentation: {
      running: 'Reading the worktrees to clean up',
      done: 'Read the worktrees to clean up',
      many: (count) => `Read the worktrees to clean up ${count} times`,
    },
  }),
  clean_up_worktrees: operation('clean_up_worktrees', {
    approval: { ...ASKS_IN_REVIEW, when: [AGENT_RUNNING, ROOT_IN_USE] },
    ...WORKTREE_WRITE,
    answer: CLEANED_ANSWER,
    meaning: 'Delete the named cleanup candidates and answer each outcome.',
    grammar: `Each worktree is judged again as list_worktree_cleanup would judge it now: one no longer a candidate refuses \`not-a-candidate\`, one with a blocker refuses \`blocked\` naming it, and the rest are deleted one after another as delete_worktree deletes, a missing folder included. Each row answers \`deleted\`, \`branch-kept\` or its refusal with its ways on, and the rest go on; \`ended\` names what each deletion stopped.`,
    input: Schema.Struct({
      rootIds: Schema.Array(worktreeId).check(Schema.isMinLength(1)).annotate({
        description: 'The worktrees to clean up, by the `rootId` list_worktree_cleanup answers.',
      }),
      idleAfterDays: Schema.optional(
        Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
          description: `The idle threshold the candidates were read with. Omitted: ${CLEANUP_IDLE_DAYS}.`,
        }),
      ),
    }),
    refusals: CLEANUP,
    subjects: (_input: unknown, prepared?: readonly FinishingPlace[] | null) =>
      (prepared ?? []).flatMap((place) => checkoutActSubjects(place.folder)),
    confirmation: (input: { readonly rootIds: readonly string[] }, prepared?: readonly FinishingPlace[] | null) => ({
      summary: `Clean up worktrees ${(prepared?.map((place) => place.folder) ?? input.rootIds).join(', ')}?`,
      consequence: deleteConsequence(),
    }),
    confirmLabel: 'Clean up',
    presentation: {
      running: 'Cleaning up worktrees',
      done: 'Cleaned up worktrees',
    },
  }),
};

export type RetirementOperationId = keyof typeof RETIREMENT_OPERATIONS;
export const RETIREMENT_OPERATION_IDS = Object.keys(RETIREMENT_OPERATIONS) as readonly RetirementOperationId[];
