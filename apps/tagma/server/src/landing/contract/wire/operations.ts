import { Schema } from 'effect';
import type { SubmitHandover } from '../../../change-record/contract/wire/handover.js';
import { COVERAGE_REFUSALS, REPOSITORY_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { GIT_REFUSALS } from '../../../platform/contract/wire/refusal.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { MergeReading, WorktreeMergeCancelled, WorktreeMerged, WorktreeMergeQueued, WorktreePullRequest } from './merge.js';
import { SHAPE_REFUSALS } from '../../../change-record/contract/wire/shape.js';
import { SubmitReceipt } from './receipt.js';
import { MergeAfter, MergeMode, type FinishingPlace } from '../../../worktrees/contract/wire/mergeTypes.js';
import { PLACE, deleteConsequence, rootId, raised, subjects } from '../../../worktrees/contract/wire/operations/retirement.js';
import { AGENT_RUNNING, LINES_OF_ANOTHER, ROOT_IN_USE, STILL_RUNNING, UNCOMMITTED } from '../../../platform/contract/wire/conditions.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { placeRole } from '../../../platform/contract/wire/place.js';
import { blockMention } from '../../../graph/contract/wire/fields.js';

export type SubmitScope = SubmitHandover & { readonly project: string; readonly checkout: string | null };

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
    approval: { ...ASKS_IN_REVIEW, when: [LINES_OF_ANOTHER, STILL_RUNNING] },
    ...WRITE,
    tool: SUBMIT_TOOL,
    subject: 'tree',
    meaning: 'Commit this session’s held lines in the named checkout, or its only held checkout, on that checkout’s current branch.',
    grammar:
      '`checkout` selects a registered checkout root; `project` alone selects its main checkout. With neither, the session’s held lines select the only checkout, and several refuse `multiple-checkouts`: call once per checkout. `taking` and `paths` narrow work in that selected tree, not the place. Without `paths`, the commit takes what the change record holds for this session in this tree. Explicit `paths` also selects changed files and deletions nobody holds. A caller whose writes the record does not see — another harness, a session outside Tagma — holds no lines and names `paths`: it lands their lines nobody holds as its own, in the checkout its call stands in. The graph’s own storage stays out, and a moved file lands as a move: its source’s deletion goes with its destination, whether the record or the index (`git mv`) pairs them; `taking` adds a named session’s held paths. Independent peer lines stay out even when adjacent; dependencies recorded between edits land automatically with their authors named in `carried`. JS/TS binding checks and conservative declaration/member-name checks over peer-held imports can refuse `lines-held`, naming the missing definition, path and holder. Matching imported member names can refuse without a proven receiver type; wait for the holder, or include the required paths with `taking` or `whole`. The operator’s own lines need the operator’s word; `taking: ["operator"]` selects them. A path whose lines cannot be told apart refuses `walk-cut`; `whole` names files or directories to carry intact within the selected paths, including peer lines, and `carried` names their holders. Relative and absolute paths are accepted; `whole: ["."]` covers every selected path. Program-written files (known lockfiles, `linguist-generated`, or whole command rewrites never touched by file tools) land whole automatically and name the other holders in `carried`; `linguist-generated=false` keeps line ownership. An open merge with a resolved index lands as a merge commit: it carries the index’s incoming changes and conflict resolutions together with the selected session lines, preserves the merge parents and clears MERGE_HEAD. Its full merged tree is judged against HEAD; commit steps leave merge commits in their merged form. A merge whose changes live peers hold is theirs unless this landing carries one of the paths it changes: it stays open and this session’s lines land beside it as an ordinary commit on HEAD; a carried path the merge changes that only peers hold refuses `lines-held` naming them. A merge HEAD moved under since it opened concludes over the current HEAD, and a path both changed refuses `tree-mid-merge`. Unresolved conflicts refuse with their paths. A cherry-pick, revert, rebase or am must conclude before this session’s lines land. Before the commit, every enforced rule triggered before submit_work whose reach the landing touches judges the built tree against HEAD: a new crossing of a rule at gate on this session’s own lines refuses `rule-violated` in every approval mode and for every caller, and a gated inspection that cannot run refuses `inspection-failed`; no mode or caller waives either, and the rule itself changes only through enforce_rule. A changed enforced inspection description also measures its rule’s whole reach in the built tree; `rechecked` names what it finds outside debt without blocking for standing findings introduced by the description alone, and remeasurement records their origins as escapes after landing. What lands anyway is named in `watched` (rules at watch), `carriedViolations` (new crossings on a live peer’s lines, or standing on a path a live peer holds uncommitted that the commit lacks) and `unjudged`. Where the `tagma.config.ts` of the commit’s own version declares `format` commands, they run first, over that version in the checkout’s commit tree, and the rules judge the tree they produced; a file a command rewrote lands in that form, and its working file takes the same change as uncommitted-by-nobody work where it merges cleanly (named in `edited`, or in `kept` where it did not). A refusal after the commands ran carries their change into the working files as this session’s uncommitted work and names those files, so the places and counts it reports read in them. A command whose tool is missing refuses `format-missing`, one that exits outside its `ok` codes `format-failed`, one that runs past its ceiling `format-cut`, and a config that does not evaluate `config-invalid`: nothing is published and no working file changes. The repository’s commit hooks run in the checkout’s commit tree, a private work tree that holds the commit’s own files; what they edit reaches the working files, on a refusal too: `edited` names the files whose working text now carries their edits — what the commit lacks of them stays this session’s to land next — and `kept` the files left as they stood. The commit carries the user’s git identity and is signed where commit.gpgsign asks; a signature git cannot make refuses `commit-unsigned` with the signer’s words. Rules triggered after submit_work run over the commit once it landed. check_rules with `over: "change"` runs the same rules over the same tree without committing, and its `refuses` says whether this act would refuse. The answer is `landed` with the commit, `committed`, the paths whose lines it carried, and `left`, the paths where lines of this session or of one it took still stand, and `unattributed`, selected paths with nobody’s lines left outside the commit, and unselected paths that changed while its commands ran without proven authorship and still stand changed in this checkout — read_changes explains the remaining authorship and command observations; name one in `paths` only when it is this session’s work — `nothing` where this session holds nothing the branch lacks, or `refused` with what git said; `tasks` declares which held tasks this commit carries; only those are attributed in the message and answer, without ending them. A declared task must be held by this session or a holder in `taking`, otherwise `task-not-held` refuses. Omitted or empty `tasks` attributes none; omission also names this session’s held tasks separately as unattributed. The subject and `body` stand as written; each declared task lands as a `Task: <name> <title>` trailer, and `Co-authored-by: Tagma <agent@tagma.dev>` joins them unless `commits.coAuthor` is off — one trailer block after a blank line, joining one the body already ends with. Author, committer and signature stay the user’s.',
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
          'Held tasks whose work this commit carries, declared by the caller. Each must be held by this session or a holder in taking. Omitted or []: attribute no tasks; when omitted, the answer separately names this session’s held tasks as unattributed.',
      }),
      paths: Schema.optional(Schema.Array(Schema.String.annotate(placeRole('value')))).annotate({
        description:
          'Files or directories selecting changed paths in this checkout, including changes nobody holds; either path of a move selects both. Without paths, select this session’s held work. Peer lines follow the same slicing and carrying rules.',
      }),
      whole: Schema.optional(Schema.Array(Schema.String.annotate(placeRole('value')))).annotate({
        description:
          'Files or directories to carry intact within the selected paths, other holders’ lines included. Does not add paths; ["."] covers the selected tree.',
      }),
      taking: Schema.optional(Schema.Array(Schema.String)).annotate({
        description:
          'Holders whose held paths this commit carries beside its own, by team name or thread id. Idle sessions need no extra consent; taking a running session’s held work raises `still-running`. `operator` carries the operator’s own lines on their word.',
      }),
      withoutFormat: Schema.optional(Schema.Boolean).annotate({
        description:
          'Make this one commit without the repository’s commit steps. Only on the operator’s word; the answer names it in `formatSkipped`.',
      }),
    }),
    answer: arms({ ok: { submitted: SubmitReceipt } }),
    refusals: [
      'no-record',
      'task-not-held',
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
      'walk-cut',
      'lines-held',
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
      const taking = input.taking ?? [];
      const where = `project “${prepared.project}”${prepared.checkout === null ? '' : ` at ${prepared.checkout}`}`;
      const skipped = input.withoutFormat === true ? ' The repository’s commit steps are skipped.' : '';
      return taking.length === 0
        ? {
            summary: `Commit this session's own lines in ${where}?`,
            consequence: `What this session still holds in this tree goes onto the current branch as one commit.${skipped}`,
          }
        : {
            summary: `Commit this session's own lines, and the held paths of ${taking.join(', ')} in ${where}?`,
            consequence: `What this session still holds in this tree goes onto the current branch as one commit, and so does what ${taking.join(', ')} holds, which stays recorded as theirs.${skipped}`,
          };
    },
    confirmLabel: 'Submit',
    presentation: { running: 'Committing', done: 'Committed', many: (count) => `Made ${count} commits` },
    subjects: (_input, prepared: SubmitHandover) => [
      ...prepared.taking.map((session) => ({ kind: 'write' as const, value: `taking:${session.threadId}` })),
    ],
    raises: (_input, prepared: SubmitHandover) => prepared.consents,
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
Where the graph is stored in the tree, the merge first delivers its pending graph through graph.commit, as sync_graph does, before reading the branch tip. A graph that cannot be delivered refuses with its recovery; graph.commit off refuses source-dirty while graph files remain uncommitted. The merge takes the branch as committed after that delivery: an agent still running in the worktree, or other uncommitted lines there, stay out of it, and an agent's call under review asks the operator first. Before git runs it refuses a merge check that conflicts (\`merge-conflicts\`) — graph files the check settled are no conflict, and \`yielded\` in the answer names those where a change of the branch gave way to the base — and — in the checkout standing on the base branch — an operation in progress, or staged entries or uncommitted lines on a path the merge writes: \`base-staged\` names the staged paths, \`base-held\` the threads holding the lines, \`base-dirty\` the paths nobody's record claims; what is staged or uncommitted on other paths stays as it stands.
Once the merged tree is known, every enforced rule triggered before merge_worktree whose reach the merge touches judges it against the base tip: a new crossing of a rule at gate refuses \`rule-violated\`, a gated inspection that cannot run \`inspection-failed\`, and \`watched\` and \`unjudged\` in the answer name what merged anyway.
The rules are read from the graph the merged tree carries. Where the graph is stored in the tree, a branch that changes it and already holds every graph change of its base is judged by its worktree's graph — module cards, rule documents and debt as the merge lands them; a branch that changes none is judged by the base's, the same graph; where both sides changed the graph since they parted, the merge first takes the base into the branch — a merge commit on the branch carrying the merged tree, its worktree's files brought to it — and the worktree's graph, now the merged one, judges. Uncommitted lines in the worktree on a path that writes refuse first: \`source-held\` names the threads holding them, \`source-dirty\` the paths nobody's record claims; a refusal after the branch took the base says so. Where the graph is stored apart from the tree, the base checkout's graph judges.
A \`rebase\` whose replay lands another tree than merging would — merge commits whose resolutions a replay drops — refuses \`rebase-merges\`. A branch that changes nothing the base lacks refuses \`already-merged\`. A \`merge\` runs the repository's \`pre-merge-commit\`, \`prepare-commit-msg\` and \`commit-msg\` hooks in the base checkout's commit tree, a private work tree holding the merged files, one hook run per checkout at a time; a hook refusal publishes nothing, and a tree a hook changed is checked and judged again. What a hook edits without staging reaches the base checkout's working files as uncommitted work, on a refusal too: the answer names those files in \`edited\` and the ones left as they stood in \`kept\`, and a refusal names them in its reason. Every mode's commits carry the user's git identity and are signed where commit.gpgsign asks; a signature git cannot make refuses \`commit-unsigned\`. Every mode runs \`post-merge\` once the base checkout holds the merge. The base branch moves only by compare-and-set from the tip that was judged; a tip that moved first is judged again, and three such races refuse \`finishing-busy\`. Once published, the merge stands: a base checkout git could not bring to it is named in \`unsynced\` with git's reason and left as it was, and a merge cut after it published is finished when the server next starts: its checkout brought to it, its receipt and notice written and its \`after\` act run unless it had already started. A cut merge whose publication can no longer be proved stays unresolved: nothing is published again for it and its queued retry stops. The graph needs no act of its own: \`graph\` answers the graph sync of the base that follows, \`carried\` where the graph is stored in the tree and merged with the code.
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
