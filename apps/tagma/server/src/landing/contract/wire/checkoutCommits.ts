import { Schema } from 'effect';
import { GIT_REFUSALS } from '../../../platform/contract/wire/refusal.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { SHAPE_REFUSALS } from '../../../change-record/contract/wire/shape.js';
import { FORMAT_SKIPPED, HOOK_FIELDS } from './receipt.js';
import { CarriedViolation, LandingUnjudged, RuleBodies, Watched } from '../../../enforcement/contract/wire/enforcement.js';
import {
  ACT,
  checkoutLabel,
  type CheckoutActPlace,
  CheckoutActed,
  MOVED,
  RECORD_UNREAD,
  WRITING_UNKNOWN,
  rootId,
  subjects,
} from '../../../workspace/contract/wire/checkoutActs.js';
import { ASKS_IN_REVIEW } from '../../../platform/contract/wire/conditions.js';

export const CheckoutCommitted = Schema.Struct({
  ...CheckoutActed.fields,
  commit: Schema.NonEmptyString,
  ahead: Schema.NullOr(Schema.Int),
  unsynced: Schema.optional(
    Schema.Array(Schema.String).annotate({
      description: 'Paths whose index entry was restaged meanwhile, left as they stood rather than reset to the commit.',
    }),
  ),
  formatSkipped: FORMAT_SKIPPED,
  watched: Schema.optional(Schema.Array(Watched)),
  carriedViolations: Schema.optional(Schema.Array(CarriedViolation)),
  bodies: Schema.optional(RuleBodies),
  unjudged: Schema.optional(Schema.Array(LandingUnjudged)),
  ...HOOK_FIELDS,
});
export type CheckoutCommitted = typeof CheckoutCommitted.Type;

export const CheckoutPulled = Schema.Struct({
  ...CheckoutActed.fields,
  head: Schema.NullOr(Schema.NonEmptyString),
  moved: Schema.Boolean,
  merge: Schema.NullOr(Schema.NonEmptyString),
  conflicted: Schema.Boolean,
  unsynced: Schema.optional(
    Schema.Array(Schema.String).annotate({
      description: 'Paths of a landed merge commit the checkout could not be brought to, left as they stood.',
    }),
  ),
  ...HOOK_FIELDS,
});
export type CheckoutPulled = typeof CheckoutPulled.Type;

const COMMITTING = ['tree-mid-merge', 'landing-busy', 'landing-cut', 'commit-unsigned', 'reshape-unreadable'] as const;

const IN_THE_TREE =
  "The checkout's commit hooks run in its commit tree — a private work tree and index Tagma keeps beside the checkout, holding the commit's own version and links to the checkout's ignored files — so a hook that stashes, checks out or resets acts there and never on another session's unfinished lines; the message hooks see the index of the commit being made. What a hook stages enters the commit and reaches the working files where it merges cleanly; what it edits without staging reaches them as uncommitted work, on a refusal too. `edited` names the files whose working text now carries the hooks' edits, `kept` the files left as they stood, and `owed` those of them the commit's form is still owed to: the change record writes it into each window once no session's lines stand there. A refusal names them in its reason.";

const SIGNED =
  "The commit carries the user's git identity and is signed where commit.gpgsign asks, as `git commit` would; a signature git cannot make refuses `commit-unsigned` with the signer's words, and a signer gets fifteen minutes to be answered.";

export const CHECKOUT_COMMIT_OPERATIONS = {
  commit_checkout: operation('commit_checkout', {
    approval: ASKS_IN_REVIEW,
    ...ACT,
    answer: arms({ ok: CheckoutCommitted.fields }),
    meaning: 'Commit what the index of a registered checkout holds, under the repository’s own identity and hooks.',
    grammar: `The message is the caller's, whole: it travels on stdin, no shell reads it, and this server adds no trailer, no attribution and no task name to it.
\`amend\` replaces the commit HEAD stands on rather than adding one, and it is the only history this act rewrites.
Where the \`tagma.config.ts\` of the index’s version declares \`format\` commands, they run first over that version in its commit tree, and what the index holds is judged in the form they produced; a commit concluding a merge is not shaped. A command whose tool is missing refuses \`format-missing\`, one that exits outside its \`ok\` codes \`format-failed\`, one past its ceiling \`format-cut\`, and a config that does not evaluate \`config-invalid\`, publishing nothing. Before a thread's commit, what the index holds is judged against HEAD by every rule triggered before submit_work, as a \`git commit\` is: a new crossing of a rule at gate refuses \`rule-violated\` and a gated inspection that cannot run refuses \`inspection-failed\`, committing nothing, and carries what the format commands changed into the working files, naming them; a tree the hooks changed is judged again. Once it lands, the rules triggered after submit_work run over it as over a landing. The operator's commit lands unjudged: once it lands it is judged against its parents, and every crossing it let in is recorded as an escape held by the operator; a rule whose inspection failed over it records its crossings at its next measure, without a holder.
${IN_THE_TREE}
${SIGNED} The branch moves only from the HEAD it was made on: a HEAD that moved meanwhile refuses \`landing-busy\`. \`amend\` keeps the amended commit's author and author date.
A merge, a cherry-pick or a revert in progress is concluded by the commit, as \`git commit\` concludes it: a merge gains its second parent, a cherry-pick keeps its author, and a sequence of picks keeps its remaining steps; a rebase in progress gains the commit. An am in progress refuses \`tree-mid-merge\`, as does \`amend\` inside a merge, cherry-pick or revert. Index entries the commit took are reset to it, and an entry restaged meanwhile is left as it stood and named in \`unsynced\`.
${WRITING_UNKNOWN}`,
    input: Schema.Struct({
      rootId,
      message: Schema.NonEmptyString.annotate({ description: 'The commit message, whole and as you wrote it.' }),
      amend: Schema.optional(Schema.Boolean.annotate({ description: 'Replace the commit HEAD stands on instead of adding one.' })),
      withoutFormat: Schema.optional(
        Schema.Boolean.annotate({
          description:
            'Make this one commit without the repository’s commit steps, on the operator’s word; the answer names it in `formatSkipped`.',
        }),
      ),
    }),
    refusals: [
      ...PLACE_REFUSALS,
      MOVED,
      RECORD_UNREAD,
      ...GIT_REFUSALS,
      ...COMMITTING,
      ...SHAPE_REFUSALS,
      'rule-violated',
      'inspection-failed',
      'module-map-invalid',
    ],
    subjects,
    confirmation: (input, prepared?: CheckoutActPlace) => ({
      summary: `${input.amend === true ? 'Amend HEAD with' : 'Commit'} what the index holds in ${checkoutLabel(input, prepared)}?`,
      consequence: `The repository's own hooks and signing run${input.withoutFormat === true ? ', and its commit steps are skipped' : ''}. With \`amend\` the commit HEAD stands on is replaced rather than added to, so anything already pushed from it diverges.`,
    }),
    confirmLabel: 'Commit',
    presentation: {
      running: 'Committing a checkout',
      done: 'Committed a checkout',
    },
  }),
  pull_checkout: operation('pull_checkout', {
    approval: ASKS_IN_REVIEW,
    ...ACT,
    answer: arms({ ok: CheckoutPulled.fields }),
    meaning:
      'Pull the branch of a registered checkout from its upstream: fetch, then merge what came in, and answer whether HEAD moved or which paths a conflict stopped the merge on.',
    grammar: `The branch's own upstream is the only source: a branch with none refuses in git's words, as \`git pull\` alone does.
Incoming work is MERGED, never rebased, and fast-forwarded where it can be, whatever the repository's pull and merge settings say: a rebase would rewrite local commits other sessions' records name by sha. A branch only behind fast-forwards; a diverged one that merges cleanly gains a merge commit with git's default pull message, made apart from the checkout — the merge, its pre-merge-commit hook and the commit happen in the commit tree, so the checkout's own files and index move only once the commit has landed, as a fast-forward of them. Paths the checkout could not be brought to are named in \`unsynced\` and left as they stood.
${IN_THE_TREE}
${SIGNED}
Nothing is stashed, whatever \`merge.autostash\` says: in a checkout other sessions write, a stash would lift their unfinished lines out of the tree. Local changes the merge would overwrite refuse in git's words before the branch or any file moves — the fetch has already run by then — and a diverged pull can refuse while the index holds staged changes.
A merge that stops on conflicts is not a refusal: git merges in the checkout itself, the answer names the conflicted paths with the threads writing them, the merge stands in progress, and commit_checkout concludes it once they are resolved. A merge already in progress refuses, as does a hook that stops the merge commit, in git's words; nothing then stands in progress.
Git asks for no credentials here: a remote that wants a password it cannot find refuses instead of waiting on a terminal nobody watches.
${WRITING_UNKNOWN}`,
    input: Schema.Struct({ rootId }),
    refusals: [...PLACE_REFUSALS, MOVED, RECORD_UNREAD, ...GIT_REFUSALS, ...COMMITTING],
    subjects,
    confirmation: (input, prepared?: CheckoutActPlace) => ({
      summary: `Pull the current branch in ${checkoutLabel(input, prepared)} from its upstream?`,
      consequence:
        'What the upstream holds is merged into the working tree; a diverged branch gains a merge commit, and a conflict leaves the merge in progress to resolve or abort.',
    }),
    confirmLabel: 'Pull',
    presentation: {
      running: 'Pulling a checkout',
      done: 'Pulled a checkout',
    },
  }),
};

export type CheckoutCommitOperationId = keyof typeof CHECKOUT_COMMIT_OPERATIONS;
