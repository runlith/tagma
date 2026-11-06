import { Schema } from 'effect';
import { COVERAGE_REFUSALS, REPOSITORY_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { GIT_REFUSALS } from '../../../platform/contract/wire/refusal.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { MergeReading, WorktreeMergeCancelled, WorktreeMerged, WorktreeMergeQueued, WorktreePullRequest } from './merge.js';
import { SHAPE_REFUSALS } from '../../../change-record/contract/wire/shape.js';
import { SubmitReceipt } from './receipt.js';
import { MergeAfter, MergeMode, type FinishingPlace } from '../../../worktrees/contract/wire/mergeTypes.js';
import { PLACE, deleteConsequence, rootId, raised, subjects } from '../../../worktrees/contract/wire/operations/retirement.js';
import { AGENT_RUNNING, ROOT_IN_USE, UNCOMMITTED } from '../../../platform/contract/wire/conditions.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { placeRole } from '../../../platform/contract/wire/place.js';
import { blockMention } from '../../../graph/contract/wire/fields.js';
import { DeriveCommand } from '../../../change-record/contract/wire/derivation.js';

export type SubmitScope = { readonly project: string; readonly checkout: string | null };

const LANDING_DOORS = { http: true } as const;
const LANDING_TOOL = { capability: 'worktrees', needs: ['shared'] } as const;

const SUBMIT_TOOL = { capability: 'shell', direct: true, needs: ['shared', 'history'] } as const;

const READ = {
  doors: LANDING_DOORS,
  tool: LANDING_TOOL,
  callers: 'any',
  waits: [],
  lifetimes: [],
  place: 'project',
  effect: 'read',
  identity: 'none',
} as const;

const WRITE = {
  doors: LANDING_DOORS,
  tool: LANDING_TOOL,
  callers: 'any',
  waits: [],
  lifetimes: [],
  place: 'project',
  effect: 'write',
  identity: { key: 'call' },
} as const;

export const LANDING_OPERATIONS = {
  submit_work: operation('submit_work', {
    approval: ASKS_IN_REVIEW,
    ...WRITE,
    tool: SUBMIT_TOOL,
    subject: 'tree',
    meaning:
      'Commit whole files of one checkout on its current branch: the files this session and its finished children changed, or every changed file under `paths`, each as it stands with every writer’s lines in it.',
    grammar:
      '`checkout` selects a registered checkout root; `project` alone selects its main checkout. With neither, the checkout holding this session’s lines is taken, and lines in several refuse `multiple-checkouts`: call once per checkout. Without `paths`, the commit takes every file the change record says this session, or a child of it no longer running, wrote that still differs from HEAD; where `agent.checkout` is `single`, every changed file. A file a command changed while several sessions’ commands ran counts for each of their teams. `paths` replaces that selection with every changed file under the named files or directories, whoever wrote it; relative and absolute paths are accepted, and a caller the change record does not see — another harness, a session outside Tagma — names them. Each file lands as it stands on disk, every writer’s lines in it included, and the commit also carries the other path of a move, every uncommitted file of a writer whose lines stand in a file you selected, and a changed file holding a declaration a carried file uses that HEAD lacks, as far as a language adapter can tell — until nothing more joins; a file that joined only for a declaration brings from its writers just their changed files that import it. Git-ignored files and the graph’s own storage stay out. Where the `tagma.config.ts` of the commit’s own version declares `format` commands, they run over the commit tree and the rules judge their form: a rewritten file lands in that form and its working file takes the same change where it merges cleanly (`edited`, or `kept` where it did not); a missing tool refuses `format-missing`, an exit outside its `ok` codes `format-failed`, a run past its ceiling `format-cut`, a config that does not evaluate `config-invalid`. When the commit leaves working changes out, the `derive` entries of the caller and of tagma.config.ts regenerate their declared outputs in the commit tree; only declared outputs enter it, and missing, failed and cut runs refuse `derive-missing`, `derive-failed` or `derive-cut`. Every enforced rule triggered before submit_work whose reach the tree touches judges it against HEAD: a new crossing of a rule at gate anywhere in it refuses `rule-violated`, naming each crossing’s place and the other writers of its line; an inspection that cannot judge lands as `unjudged` with its failure, also recorded in the rule’s history; `watched` and `rechecked` name findings that land anyway. An open merge whose index is resolved concludes with the first landing that carries a path it changed, as a merge commit carrying its incoming changes and resolutions; a landing carrying none of them lands beside it as an ordinary commit; unresolved conflicts refuse `tree-mid-merge`, and a cherry-pick, revert, rebase or am must conclude first. The repository’s commit hooks run in a private commit tree; what they edit reaches the working files (`edited`, `kept`). The commit carries the user’s git identity and is signed where commit.gpgsign asks; a signature git cannot make refuses `commit-unsigned`. HEAD moves only by compare-and-set from the judged base, a moved HEAD rebuilds or rebases the tree, and repeated races refuse `landing-busy`. check_rules with `over: "change"` builds the same tree and its `refuses` says whether this act would refuse it. `tasks` names the tasks whose work the commit carries, whoever holds them; each lands as a `Task: <name> <title>` trailer and none is ended; omitted, the answer names this session’s held tasks as unattributed. The subject and `body` stand as written, and `Co-authored-by: Tagma <agent@tagma.app>` joins the trailers unless `commits.coAuthor` is off. The answer is `landed` with the commit, `committed`, `carried` (files holding other writers’ lines, with those writers), `unattributed` (files holding lines no tool recorded) and `left` (files of this session and its finished children the commit did not carry, with why); `nothing` with the commits that already carried those lines; or `refused` with what git said.',
    input: Schema.Struct({
      project: Schema.optional(Schema.Union([Schema.String, Schema.Int])).annotate({
        ...placeRole('selector'),
        description: 'The registered project name or id, global or tagma; checkout names its working copy.',
      }),
      checkout: Schema.optional(Schema.NonEmptyString.annotate(placeRole('checkout'))).annotate({
        description:
          'The checkout root to land in. With neither project nor checkout, the session must hold lines in at most one checkout.',
      }),
      subject: Schema.optional(Schema.String).annotate({
        description: 'The message subject, kept as written; each task declared in tasks lands as a `Task: <name> <title>` trailer.',
      }),
      body: Schema.optional(Schema.String).annotate({
        description: 'The message body below the subject: what changed in behaviour and why.',
      }),
      tasks: Schema.optional(Schema.Array(blockMention)).annotate({
        description:
          'Tasks whose work this commit carries, whoever holds them. Omitted or []: attribute no tasks; when omitted, the answer separately names this session’s held tasks as unattributed.',
      }),
      paths: Schema.optional(Schema.Array(Schema.String.annotate(placeRole('value')))).annotate({
        description:
          'Files or directories whose changed files this commit takes, whoever wrote them; either path of a move selects both. Without paths, the files this session and its finished children wrote.',
      }),
      derive: Schema.optional(Schema.Array(DeriveCommand)).annotate({
        description:
          'Commands that regenerate the named output paths in the commit tree when derived content would otherwise carry inputs left outside the commit. Output paths are repository-relative globs; argv runs at the repository root without appended file operands. Working outputs stay untouched.',
      }),
      withoutFormat: Schema.optional(Schema.Boolean).annotate({
        description:
          'Make this one commit without the repository’s formatting commands. Required derivations still run. Only on the operator’s word; the answer names it in `formatSkipped`.',
      }),
    }),
    answer: arms({ ok: { submitted: SubmitReceipt } }),
    refusals: [
      'no-record',
      'not-work',
      'bad-name',
      'not-found',
      'ambiguous-name',
      'no-branch',
      'git-unavailable',
      'git-not-admitted',
      'root-unproven',
      'multiple-checkouts',
      'place-mismatch',
      'tree-mid-merge',
      'path-unread',
      'rule-violated',
      'inspection-failed',
      'module-map-invalid',
      'graph-required',
      'landing-busy',
      'landing-cut',
      'commit-unsigned',
      'reshape-unreadable',
      ...SHAPE_REFUSALS,
    ],
    confirmation: (input, prepared: SubmitScope) => {
      const where = `project “${prepared.project}”${prepared.checkout === null ? '' : ` at ${prepared.checkout}`}`;
      const skipped = input.withoutFormat === true ? ' The repository’s commit steps are skipped.' : '';
      return {
        summary: `Commit ${input.paths === undefined ? "this session's changed files" : 'the changed files under the named paths'} in ${where}?`,
        consequence: `The files go onto the current branch as one commit, as they stand, with every writer’s lines in them.${skipped}`,
      };
    },
    confirmLabel: 'Submit',
    presentation: { running: 'Committing', done: 'Committed', many: (count) => `Made ${count} commits` },
    subjects: () => [],
    negative: (answer: { readonly submitted: { readonly status: string } }) => answer.submitted.status === 'refused',
  }),

  check_worktree_merge: operation('check_worktree_merge', {
    approval: ASKS_NEVER,
    ...READ,
    subject: 'head',
    graph: 'none',
    meaning:
      "Take the merge check of one worktree: whether its branch merges cleanly into its base branch's tip, or the paths that conflict.",
    grammar: `The check runs git's own merge in memory (\`merge-tree --write-tree\`) of the branch tip against the base branch's current tip. An incoming graph whose format is behind the base is brought forward in a temporary tree first; the branch and base checkout files and refs stay unchanged. The result is kept per pair of tips and taken again when either moves, and the listing's \`check\` and \`conflicts\` status read the same answer.
Where only files of the graph kept in the tree conflict, the check settles them by block identity: a block one side moved merges its three sides at its new place, and where the texts cannot be joined the base branch's side holds; \`yielded\` names the graph files where a change of the branch gave way. A conflict on any other path, a side that does not read as a block, two different blocks on one path, or a settlement that would remove the index of a directory still holding a block file, leaves every conflict standing.
\`unknown\` rides with a reason where no base branch is recorded, the folder is gone, or a tip names no commit.`,
    input: Schema.Struct({ rootId }),
    answer: arms({ ok: { merge: MergeReading } }),
    refusals: [...PLACE, ...GIT_REFUSALS],
    subjects: () => [],
    confirmation: (input) => ({ summary: `Check whether worktree ${input.rootId} merges cleanly?` }),
    confirmLabel: 'Check merge',
    presentation: {
      running: 'Checking a worktree merge',
      done: 'Checked a worktree merge',
      many: (count) => `Checked ${count} worktree merges`,
    },
  }),
  merge_worktree: operation('merge_worktree', {
    approval: { ...ASKS_IN_REVIEW, when: [AGENT_RUNNING, ROOT_IN_USE, UNCOMMITTED] },
    ...WRITE,
    subject: 'tree',
    graph: 'none',
    meaning: 'Merge a worktree into the checkout of its base branch, after every check that can refuse has refused before git runs.',
    grammar: `Modes: \`merge\` (the default) lands a merge commit on the base; \`squash\` lands one commit carrying the branch's whole change; \`rebase\` replays the branch's commits onto the base tip, moves the branch there, and fast-forwards the base to it.
Where the graph is stored in the tree, the merge first delivers its pending graph through graph.commit, as sync_graph does, before reading the branch tip. A graph that cannot be delivered refuses with its recovery; graph.commit off refuses source-dirty while graph files remain uncommitted. The merge takes the branch as committed after that delivery: an agent still running in the worktree, or other uncommitted lines there, stay out of it, and an agent's call under review asks the operator first. Before git runs it refuses a merge check that conflicts (\`merge-conflicts\`) — graph files the check settled are no conflict, and \`yielded\` in the answer names those where a change of the branch gave way to the base — and — in the checkout standing on the base branch — an operation in progress, or staged entries or uncommitted lines on a path the merge writes: \`base-staged\` names the staged paths, a staged path inside a directory the merge turns into a file, or a file standing where the merge makes a directory, among them, \`base-held\` the threads holding the lines, \`base-dirty\` the paths nobody's record claims; what is staged or uncommitted on other paths stays as it stands.
Once the merged tree is known, every enforced rule triggered before merge_worktree whose reach the merge touches judges it against the base tip: a new crossing of a rule at gate refuses \`rule-violated\`, an inspection that cannot judge lands as \`unjudged\` with its failure in the answer and the rule’s history, and \`watched\` names findings that merged anyway.
The rules are read from the graph the merged tree carries. Where the graph is stored in the tree, a branch that changes it and already holds every graph change of its base is judged by its worktree's graph — module cards, rule documents and debt as the merge lands them; a branch that changes none is judged by the base's, the same graph; where both sides changed the graph since they parted, the merge first takes the base into the branch — a merge commit on the branch carrying the merged tree, its worktree's files brought to it — and the worktree's graph, now the merged one, judges. Uncommitted lines in the worktree on a path that writes refuse first: \`source-held\` names the threads holding them, \`source-dirty\` the paths nobody's record claims; a refusal after the branch took the base says so. Where the graph is stored apart from the tree and the worktree has a graph twin (stealth), the worktree's graph judges: when the base's twin holds graph commits the worktree's lacks, the merge first takes the base into the branch, the same merge as above, so the branch's twin takes the base's twin; a twin merge that conflicts or cannot be read refuses, naming why. Without a twin the base checkout's graph judges.
A \`rebase\` whose replay lands another tree than merging would — merge commits whose resolutions a replay drops — refuses \`rebase-merges\`. A branch that changes nothing the base lacks refuses \`already-merged\`. A \`merge\` runs the repository's \`pre-merge-commit\`, \`prepare-commit-msg\` and \`commit-msg\` hooks in the base checkout's commit tree, a private work tree holding the merged files, one hook run per checkout at a time; a hook refusal publishes nothing, and a tree a hook changed is checked and judged again. What a hook edits without staging reaches the base checkout's working files as uncommitted work, on a refusal too: the answer names those files in \`edited\` and the ones left as they stood in \`kept\`, and a refusal names them in its reason. Every mode's commits carry the user's git identity and are signed where commit.gpgsign asks; a signature git cannot make refuses \`commit-unsigned\`. Every mode runs \`post-merge\` once the base checkout holds the merge. The base branch moves only by compare-and-set from the tip that was judged; a tip that moved first is judged again, and three such races refuse \`finishing-busy\`. Once published, the merge stands: the base checkout's index and files are brought to it path by path, a path holding uncommitted work keeps its file, its index taking the merge unless the work was staged, and is named in \`unsynced\` with the reason, a checkout git could not bring at all is named whole and left as it was, and a merge cut after it published is finished when the server next starts: its checkout brought to it, its receipt and notice written and its \`after\` act run unless it had already started. A cut merge whose publication can no longer be proved stays unresolved: nothing is published again for it and its queued retry stops. The graph needs no act of its own: \`graph\` answers the graph sync of the base that follows, \`carried\` where the graph is stored in the tree and merged with the code.
\`after: delete\` deletes the worktree once it merged, as delete_worktree does, and \`after\` in the answer says how that went; a refused deletion leaves the merge standing.
With \`whenBaseFree\`, a merge refused only because the base checkout is busy — \`base-held\`, \`base-staged\`, \`base-mid-operation\`, \`finishing-busy\` — is queued instead: the answer is \`queued\`, the server tries it again whenever the base checkout or the branch moves and every two minutes, across restarts, until it lands or meets another refusal, which stops it and stands on the worktree's row as \`pending\`, and goes by itself once what that refusal rests on changes: the tips of the branch and its base, and for a refusal over a checkout's state — \`base-dirty\`, \`base-not-checked-out\`, \`source-held\`, \`source-dirty\`, \`operation-in-progress\`, \`no-branch\` — that checkout's branch, operation, uncommitted entries and the lines held among them. A refusal whose ground changed while it was met leaves the merge queued. cancel_worktree_merge drops it; a merge that lands, or deleting the worktree, drops it too, while a merge asked again and refused leaves it standing.
An \`after\` deletion ends what still runs in the worktree as delete_worktree does, under the caller's reach — a queued merge keeps the caller and spends that caller's reach when it lands; the worktree the calling thread stands in refuses \`own-worktree\` with an \`after\` that deletes it.`,
    input: Schema.Struct({
      rootId: rootId.annotate(placeRole('value')),
      mode: Schema.optional(MergeMode.annotate({ description: 'merge (default), squash or rebase.' })),
      message: Schema.optional(
        Schema.NonEmptyString.annotate({
          description: 'The subject and body of the merge or squash commit. Omitted: one naming the worktree, its branch and its base.',
        }),
      ),
      after: Schema.optional(
        MergeAfter.annotate({
          description: 'keep (default) leaves the worktree standing; delete deletes it as delete_worktree does.',
        }),
      ),
      whenBaseFree: Schema.optional(
        Schema.Boolean.annotate({
          description: 'Queue the merge while the base checkout is busy instead of refusing.',
        }),
      ),
    }),
    answer: arms({ merged: WorktreeMerged.fields, queued: WorktreeMergeQueued.fields }),
    refusals: [
      ...PLACE,
      'root-unproven',
      'folder-missing',
      'no-branch',
      'no-base-branch',
      'own-worktree',
      'operation-in-progress',
      'base-not-checked-out',
      'base-mid-operation',
      'base-staged',
      'base-held',
      'base-dirty',
      'source-held',
      'source-dirty',
      'merge-conflicts',
      'already-merged',
      'rebase-merges',
      'rule-violated',
      'inspection-failed',
      'module-map-invalid',
      'finishing-busy',
      'finishing-cut',
      'commit-unsigned',
      ...COVERAGE_REFUSALS,
      ...REPOSITORY_REFUSALS,
      ...GIT_REFUSALS,
    ],
    subjects,
    raises: raised,
    confirmation: (input, prepared?: FinishingPlace | null) => ({
      summary: `Merge worktree ${prepared?.folder ?? input.rootId} into ${prepared?.base ?? 'its base checkout'}${input.mode === undefined ? '' : ` (${input.mode})`}${input.whenBaseFree === true ? ', now or once the base is free' : ''}?`,
      consequence: [
        'The base checkout gains the branch’s work under the repository’s own hooks; a rebase also rewrites the worktree’s branch onto the base tip.',
        ...(input.after === 'delete' ? [`Once merged: ${deleteConsequence()}`] : []),
      ].join(' '),
    }),
    confirmLabel: 'Merge',
    presentation: {
      running: 'Merging a worktree',
      done: 'Merged a worktree',
    },
  }),
  cancel_worktree_merge: operation('cancel_worktree_merge', {
    approval: ASKS_IN_REVIEW,
    ...WRITE,
    subject: 'none',
    meaning: 'Drop the merge of a worktree that waits for its base checkout to be free, or one that stopped.',
    grammar:
      'Answers the dropped merge as it stood. A try already running finishes first, and when it landed there is nothing left to drop: `not-pending`.',
    input: Schema.Struct({ rootId }),
    answer: arms({ cancelled: WorktreeMergeCancelled.fields }),
    refusals: ['not-pending', 'worktree-unavailable', 'finishing-busy'],
    subjects: () => [],
    confirmation: (input) => ({ summary: `Stop the merge of worktree ${input.rootId} that waits for its base?` }),
    confirmLabel: 'Stop waiting',
    presentation: {
      running: 'Dropping a waiting worktree merge',
      done: 'Dropped a waiting worktree merge',
    },
  }),
  open_worktree_pr: operation('open_worktree_pr', {
    approval: ASKS_IN_REVIEW,
    ...WRITE,
    subject: 'none',
    meaning: "Push a worktree's branch to its remote and open a pull request against its base branch with the GitHub CLI.",
    grammar: `The branch is pushed to the remote a publish would take — its push remote, else the only remote, else origin — with its upstream set, then \`gh pr create\` runs in the worktree. It refuses \`no-gh\` where gh is not installed and \`no-remote\` where the branch has nowhere to go, both before anything is pushed. A push that landed stands when gh then refuses, and \`gh-refused\` says so.
A pull request already open for the branch is answered with \`opened: false\` instead of a second one. Omitted, the title and body are filled from the commits (\`gh --fill\`). \`uncommitted\` counts the paths whose lines the pull request does not carry. gh is given two minutes.`,
    input: Schema.Struct({
      rootId,
      title: Schema.optional(Schema.NonEmptyString),
      body: Schema.optional(Schema.String),
      draft: Schema.optional(Schema.Boolean),
    }),
    answer: arms({ opened: WorktreePullRequest.fields }),
    refusals: [...PLACE, 'folder-missing', 'no-branch', 'no-base-branch', 'no-gh', 'no-remote', 'gh-refused', ...GIT_REFUSALS],
    subjects,
    raises: raised,
    confirmation: (input, prepared?: FinishingPlace | null) => ({
      summary: `Push ${prepared?.folder ?? input.rootId} and open a pull request${input.title === undefined ? '' : ` “${input.title}”`}?`,
      consequence: 'The branch is published to its remote, where others can see it.',
    }),
    confirmLabel: 'Open pull request',
    presentation: {
      running: 'Opening a pull request',
      done: 'Opened a pull request',
    },
  }),
};

export type LandingOperationId = keyof typeof LANDING_OPERATIONS;
export const LANDING_OPERATION_IDS = Object.keys(LANDING_OPERATIONS) as readonly LandingOperationId[];

export const MERGE_OPERATION_IDS: readonly LandingOperationId[] = LANDING_OPERATION_IDS.filter((id) => id !== 'submit_work');
