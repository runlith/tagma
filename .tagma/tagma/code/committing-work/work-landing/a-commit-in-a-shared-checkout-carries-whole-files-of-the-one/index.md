---
id: 01a1a2a8-2c45-7165-b236-7e590b47ae60
title: A commit in a shared checkout carries whole files of the one tree, credits every writer, and only the project's checks refuse it
ord: 202
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0d0a7-c14d-73e8-a333-1f082a55b1e4
  - kind: relates
    to: 01a1166f-7230-7a1c-8607-9b7ce87e8682
  - kind: relates
    to: 01a14023-ae85-7923-8206-776803b72225
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b854ec4a27
  - kind: relates
    to: 01a14c37-8dee-7add-92fe-a780ec14ea5c
  - kind: relates
    to: 01a16487-9741-727f-8ed9-9973d2548c8d
  - kind: relates
    to: 01a16495-f5ab-78e9-8089-7d7cd5e18238
  - kind: relates
    to: 01a1a183-c38c-72bb-8d73-20eaafa95730
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/dependencies.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/place.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
  - kind: file
    ref: apps/tagma/server/src/landing/doctrine/commits.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/submit.ts
  - kind: file
    ref: apps/tagma/server/src/landing/operations/submit.ts
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/heldTasks.ts
  - kind: symbol
    ref: apps/tagma/server/src/landing/contract/wire/operations.ts
    symbol: LANDING_OPERATIONS
---
## The problem

When several agents share a checkout and their changes touch, landing finished work costs more than writing it. The operator has asked to remove this three times. On 2026-09-23 agents negotiated hunks in shared files ([[2a55b1e4]] was the answer). On 2026-10-22 two finished agents refused each other's landings in a circle ([[d2548c8d]]). On 2026-11-03 seven sessions fixed one installation seam: cluster A was ready at 17:29 UTC and still unlanded at 18:06, waiting on peers' idleness, a peer's review and an agreed landing order. Over the day the lead's tree sent 223 messages and ran 20 `submit_work` calls and 10 `check_rules` probes; 7 of the calls and 6 of the probes refused. Nine tasks travelled to the parent and were claimed back twice. Of the seven refused landings, three were real defects in the caller's own code (`rule-violated`) and one was a malformed call. The other three — two `lines-held` and one `task-not-held` — guarded nothing real, and neither did any of the waiting.

## The root

Tagma treats an uncommitted line as the property of the session that wrote it, and a commit as that session handing over its property. A shared checkout contradicts this premise. Every agent reads, builds on and tests the whole tree, other agents' uncommitted lines included. One session's lines are therefore often not a working program on their own, and the lines of several sessions are often one change. Tagma made "who wrote it" the boundary of "what may land together", and authorship is a poor stand-in for coherence.

The rest follows from that one decision:
- **The door cuts each session's lines out of shared files.** The result is a tree nobody ever ran. When such a tree reached the checkout build as a broken HEAD on 2026-10-15 ([[03b72225]]), Tagma began proving cut trees safe with its own JS/TS binder and type placement. That check refuses on false name matches (`length`, `.map`, `get` and others, over ten reflections), sees nothing in any other language, and is incomplete even for JS/TS, as its own explanation states.
- **Where a cut cannot be proven, the door hands the decision to the agents** as a transfer of property between them:
  - `lines-held` names a holder and advises waiting for it ("wait for the named holders to land their declarations");
  - `taking` brings in another session's lines, and asks consent when that session is still running (`still-running`);
  - `whole` overrides the cut;
  - the operator's word is required in places;
  - `walk-cut` refuses when authorship is unproven.
- **Tasks have the same custody.** A commit may name only tasks that its own or taken sessions hold (`task-not-held`). A child's tasks pass to its parent whenever the child rests, so the lander has to claim them back.
- **The prompt teaches agents to respect the property.** Never land a working session's unfinished file, and follow the refusal by waiting for the holder. A ready agent therefore waits for peers who are themselves waiting.

Each round of fixes changed the mechanism and kept the premise:
- On 09-23, landing moved from whole files to cutting by author.
- On 10-22, carrying lines within a file and taking idle sessions without consent were added.
- On 10-23 the cross-file dependency refusal was added, and on 10-28 its false matches were narrowed.

Every round closed one case and opened the next. The Work landing and Line authorship modules now hold 218 reflections (188 of them answered) and 116 tasks. This is a wrong product decision, not a defect: the code does what it was designed to do.

## The model from now on

- **One shared tree.** The checkout's uncommitted state is one tree. Lines have authors, who are recorded and shown, but nobody owns them.
- **A commit is whole files.** A commit is a part of that tree: a set of whole files as they stand on disk. Every file in a commit is one that existed and that the agents' own checks ran over. No commit carries a file cut by author.
- **Ready is a property of the tree.** Work is ready when the tree the commit would carry passes the project's checks; it is not a state of a session. Any session may land any part of the tree. Landing needs nobody's consent, idleness, task custody or message.
- **The operator is a writer like any other.** His edits in Tagma's editor are recorded and shown as his, and ride with a commit like anyone's.

## submit_work

**Selection.** A bare call selects whole files: the files the change record says the caller wrote, plus those written by its descendants that are no longer running. Only files that still differ from HEAD are selected. Selection only needs to know which files the team wrote, not whose lines stand inside them, so landing no longer waits for a fresh line judgement. When the record cannot tell which of several overlapping commands wrote a file, the file counts for every one of their teams. Carrying a file whole is harmless, so the ambiguity no longer costs a lost file or a refusal. In a checkout declared `single`, a bare call selects every changed file. `paths` replaces the default: every changed file under the named files or directories, whoever wrote it. A caller the record does not see (another harness, a session outside Tagma) names `paths`, as today.

**What rides along without being asked for:**
- Every line in a selected file, whoever wrote it: other sessions' lines, and lines no tool recorded.
- The whole change of every writer whose lines ride. When a commit carries another writer's lines, it also carries every file that writer has changed and not committed, and in turn the changes of the writers in those files. A writer's uncommitted lines are one change that only ever existed whole. A changed declaration rides together with the callers its writer updated, and a new route rides with the new file it points to. This needs no language knowledge, and it keeps the safety `taking` gave by carrying a writer's whole held work.
- The other path of a move, as today.
- Files the commit cannot do without, as far as a language adapter can see. The code-facts port gains this question: which changed files does this text need? When the adapter for a carried file's language finds a reference to a declaration that exists only in another changed file, that file rides too, whole, and the walk continues from it. Today's JS/TS/Svelte binder and placement become this adapter. A false match now costs a larger commit, never a refusal. A language without an adapter adds nothing, and the project's checks judge.
- Derived outputs: `derive` and the config's declarations regenerate them, and derived content nobody declared lands as it stands. The `derive-required` refusal goes, because the writer's whole change already carries the inputs it was generated from.

**What stays out.**
- Git-ignored files and the graph store, as today.

**The judge.** Commit steps, hooks and every gated rule judge the tree that would land, as today. A new crossing anywhere in that tree refuses, whoever wrote the line. The refusal names the rule, the place and that line's author, as information. Its ways out:
- fix it (a line whose writer is no longer changing it is anyone's to fix);
- land without that file through `paths`;
- when the crossing stands in lines another writer is still changing, leave your own lines in that file — they land with the next commit that carries it.

No refusal names a holder to wait for or to take from.

**An open merge** whose index is resolved concludes with the first landing that carries a path the merge changed. A landing that carries none of them lands beside it as an ordinary commit. Unresolved conflicts refuse with their paths, as today.

**The answer:**
- `landed` with the commit;
- `carried`: files holding other writers' lines, with those writers;
- `unattributed`: files holding lines no tool recorded;
- `left`: the team's files this commit did not carry, each with its reason — left out by `paths`, or written again after the landing read them. Every part of this answer is a fact of the record and git, with no line judgement after the commit.
- When the team has nothing left to land because other commits already carried its lines, `nothing` names those commits.

**What leaves the contract:**
- `taking` and `whole`;
- the `still-running` and `lines-of-another` conditions;
- `lines-held` and `walk-cut` as landing refusals (a file that cannot be read refuses as a read failure);
- `task-not-held`;
- the court's `carriedViolations` exemption.

`check_rules` over a change builds the same tree in the same way. Its `taking` and `whole` go too, and its `refuses` means any new gated crossing in that tree.

## Tasks

- `tasks` names the tasks whose work the commit carries, whoever holds them, and the commit writes their `Task:` trailers. Holding a task proves no part in a commit ([[478a6934]] already says so), so holding gates nothing at landing.
- A child's tasks still pass to its parent when it rests, as the record of who now answers for them. Inside one team tree, holding is a note of who is on a task. Finishing, closing or attributing a task a teammate holds raises no `held-elsewhere` question.

## The prompt

- **Commits** (`landing/doctrine/commits.ts`, shared mode) says:
  - `submit_work` commits the files you and your finished children changed, as they stand, with every writer's lines in them included and credited;
  - name in `paths` any other changed file your change needs;
  - no consent, state or task of anyone is needed, and no message about a commit is sent;
  - follow a refusal's ways out, and when your lines wait on another writer's, say so in your report and end.

  The sentences about `taking`, `whole`, `still-running` and a parent's `taking` go.
- **Single mode.** In `single`, the promise that `submit_work` takes the whole tree becomes true.
- **The shared-checkout section** keeps its law: no stash, reset or clean under others, and a genuine edit conflict is the only question. "Landing dependent peer lines" becomes "a commit carrying another writer's lines is no edit conflict".
- **Operation descriptions.** The descriptions of `submit_work` and `check_rules` are rewritten to match this spec. The doctrine and description text shrink.

## What stays, and why it is real

1. **No new gated crossings.** A commit never adds a new crossing of a gated rule, judged on the tree that lands. HEAD feeds checkout builds, worktrees and pushes.
2. **No file nobody had.** A commit never carries a file that nobody had on disk. The landed tree is as close to what the agents ran as a partial commit can be.
3. **No missing declarations, where an adapter sees them.** A commit never leaves out an uncommitted declaration its code needs. This is the failure of [[03b72225]].
3a. **No half of another writer's change.** A commit that carries any of a writer's lines carries all of that writer's uncommitted change, so a changed signature never lands without the callers its writer updated.
4. **Authorship stays.** It is recorded and shown everywhere, and a thread's lines still roll back without touching others' lines.
5. **The rest is unchanged:** publication by compare-and-set, rebuild on a moved HEAD, moves as pairs, derivations, and hooks in the commit tree.

## What is removed, and what each protected

- **Cutting a file by author:** line selection, the overlay of selected regions over a merge index, team observations, the fresh judgement before landing, and `walk-cut`. It gave each session its own commit in a shared file, at the price of trees nobody ran.
- **`lines-held` between sessions,** with its advice to wait. It stopped a cut from dropping what it needed. Carrying the needed file does that without asking anyone.
- **`taking`, `still-running` and `whole`.** They moved another session's property into a commit, and with no property there is nothing to move. A running writer loses nothing when a commit carries its coherent lines: its next lines land later. Its incoherent lines are stopped by the checks, not by its run state.
- **`task-not-held` and claiming tasks back:** custody used as proof of attribution.
- **`carriedViolations`,** through which another writer's violation reached HEAD unjudged.

## The trade

- **Commits follow the tree, not the session.** Two writers in one file land together in whichever commit comes first. A commit's subject describes its caller's change, and the receipt and the per-line authors of a commit in the Git tab show who else rode along.
- **Your lines can wait for another writer's.** When another writer's lines in a file you need do not yet pass the checks, your lines in that file wait and land with theirs. Under heavy concurrency a shared file lands later than a cut by author would have landed it, but no agent waits, asks or messages for it.
- **Commits grow with entanglement.** Where many agents share files, a commit takes in every change entangled with it through those files, and lands only once all of them pass the checks. It is larger, and it lands no earlier than the slowest of those changes.
- **Everyone's lines ride along.** The operator's edits, and lines no tool recorded such as edits from an editor outside Tagma, ride with a file an agent lands and are named in the answer. Git-ignored files such as `.env` never land.

## Every user

- **One agent in one checkout.** Its files land whole, including the person's own tweaks from outside Tagma, which are named. Nothing refuses but the checks.
- **A few agents on separate files:** unchanged.
- **Many agents sharing files,** as on 2026-11-03. Whoever is ready lands. Entangled work lands in one commit, made by whichever session gets there first. Nobody waits, takes, claims or messages.
- **Worktrees.** Each is a shared tree under the same rules, and `merge_worktree` is unchanged.
- **Any language, and projects without code.** Whole files are correct for every language, and a language with an adapter also gets missing declarations carried. A project that wants every commit to build, in any language, enforces its own build or typecheck as a gated program inspection, which is an existing mechanism.
- **Scale.** A landing costs work in proportion to the files it carries, with no per-line fold or judgement. The adapter runs only where a carried file imports a changed one.

## Owners and boundaries

- **landing:** owns the `submit_work` contract, its receipt, the Commits section, and the call into the court.
- **change-record:** builds the prepared change from whole files, runs the carry walk through the code-facts port, and answers `left`, `carried` and `unattributed` from the record and git. Its slicing goes. It stays below landing.
- **code-facts:** the language port answers which changed files a text needs, with JS/TS/Svelte as the adapter behind its contract (rule 6f758080).
- **enforcement:** judges the built tree with no own-lines gating, for `submit_work` and `check_rules` over a change alike.
- **threads and graph:** task handover, and `held-elsewhere` within a team.

## Migration

- **Stored data:** nothing changes. Record rows, Holdings and debt stay, and lines uncommitted today land under the new rules at their next landing.
- **Contract:** `taking`, `whole` and the removed refusals and conditions leave `submit_work` and `check_rules` in one change, together with their descriptions and the doctrine. This breaks operation inputs, so the commit carries `!`. Running threads read the new text at their next instruction refresh; until then, a call that still names `taking` or `whole` is refused as a malformed call that names the field.
- **Records on acceptance:** task [[afa95730]] (refining line-cut landings) and idea [[e87e8682]] (an act that takes nobody's lines) lose their subject and close, and the third point of [[ec14ea5c]] is answered by the `single` selection.
- **Records on build:** the blocks that describe landing are rewritten from the new code:
  - the features [[54ec4a27]], [[29e7e083]], [[cfdb998e]], [[cc335a96]] and [[a28ec4cb]] (the operator's edits now ride agents' commits);
  - the explanations [[0c6f0a9e]], [[ffe2dc34]], [[208a6ab1]], [[4c940a20]], [[478a6934]] and [[28ba4c77]];
  - the handover sentence of the `#task` tag.

## Acceptance

Performer checks run through the real native door.

1. Two running sessions whose JS/TS changes reference each other's new declarations in separate files. Either session's bare `submit_work` lands both files in one commit, with no refusal and no question in review mode, and `carried` names the other session.
2. Two sessions edit separate places of one file. The first landing's blob equals the working bytes it read. The second session's bare `submit_work` answers `nothing` and names that commit.
3. A gated crossing stands in another session's lines in a selected file. `rule-violated` names the rule, the place and the author, and its ways out name neither waiting nor taking. After that writer fixes it, the next landing carries both.
4. A file an agent lands also holds the operator's recorded lines. The commit carries them with no question in any mode, and `carried` names the operator.
5. A parent's bare `submit_work` after its child rested lands the child's files and attributes the child's tasks named in `tasks`, with no claim. A teammate finishing that task raises no question.
6. A two-file change in a language with no adapter lands its selected files whole and adds nothing. When one of those files also holds another writer's lines, that writer's other changed files ride too.
6a. B changed a declaration in one file and its caller in another. A's landing, which needs that declaration, carries both of B's files, and the landed tree typechecks.
7. In a `single` checkout, a bare `submit_work` lands every changed file.
8. `check_rules` over a change answers `refuses` exactly when `submit_work` would refuse that tree.
9. The `submit_work` and `check_rules` descriptions and the Commits section mention neither `taking`, `whole` and `still-running` nor waiting for a holder. The doctrine tests read the new text, and the performer's prompt is not larger than before.
