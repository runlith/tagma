---
id: 01a16412-1dd9-7130-8237-2ac7eac81165
title: "Navigation gate step 2 before runs: selection rule, 12 tasks, a with/without-navigation stand, 36 pairs and an estimate"
ord: 4
---
Gate step-2 preparation: selection rule, twelve tasks, stand, and estimate. Not a single agent run happened; runs start after [[0d43b65d]] and [[2eb85f6b]] land and the operator restarts the server. Task — [[1f4a3bdb]].

## Selection rule (recorded 2026-10-22 before runs)

Population: first-parent `main` commits, back from `6dedcaeeb3`, newest first; `tagma: graph @` commits do not count. A commit is taken when all of the following hold:

- **M1.** Changes at least one non-test `.ts`/`.tsx`/`.js` file outside `archive/` and `.tagma/`.
- **M2.** Non-test code: 10 to 600 changed lines (added + removed) and no more than 15 files — one agent's work in one run.
- **M3.** Changes or adds at least one test file (`*.test.ts`, `*.itest.ts`, `*.stest.ts`) — the task has its own check.
- **S1.** Changes behaviour (not just a name, type, description text, or formatting) of a member that existed in the parent commit: a method or property of an exported interface, type, class, or Effect service form, or an implementation of such a member.
- **S2.** In the parent commit that member has several implementations or callers (not tests) in two or more modules. Module: `packages/<name>`, `apps/tagma/server/src/<folder>`, `apps/tagma/app/src/lib/<section>/<folder>`. Proof is `git grep -P` for the member name in the parent, grouped by module, plus diff reading.
- **S3.** The task is solvable from the repository and its text, without vendor CLIs, network, or the operator's accounts.

The first 12 passing commits are taken. M1–M3 are mechanical (a script over `git show --numstat`); S1–S3 are diff reading; a rejection is recorded with a cause. Before runs each task passes **V**: the commit's tests overlaid on the parent (`git checkout <commit> -- <test files>`) — at least one fails, while on the commit itself all pass. A task failing V is replaced by the next one under the same rule.

## Tasks

Each start state is the parent commit (`<commit>^`). The task text to the agent is as the operator would put it, with no `file:line`; the verbatim text is below. Outcome check: the commit's tests overlaid on the agent's result pass; `bun run typecheck` of the affected packages is clean; the agent diff is compared against the real edit (which members and callers were touched, what was missed); review findings.

1. **`c806960298`** — navigation: the first question waits for the engine. Member: the engine port's `Process`/`EngineState` (`packages/navigation`; implementation in `navigation-ts`, the holder consumer in the server). Tests: `navigation/holder.test.ts`, `holder.itest.ts`, `packages/navigation/src/navigation.itest.ts`.
   > A `definition` or `uses` question to a checkout whose engine is still rising currently answers with all occurrences "unverified: loading" and asks to come back later — useless to an agent. Let the question wait until the engine has risen and served the first snapshot, and answer with verdicts; if the engine has fallen or is stopping meanwhile, the question waits for the engine's next generation. There is no more "loading" state in the answer — fix the operation descriptions too.
2. **`8abee2052c`** — navigation: a lease holds the served snapshot. Member: the same port's `Process.served` and `Served`. Test: `navigation/holder.test.ts`.
   > In navigation the kit asks one question with several adapter calls, while the holder hands the adapter separately from the snapshot, so the snapshot can change mid-question. Make snapshot and adapter arrive together and keep the snapshot held in the question scope until its end. Additionally: all checkouts' engines share one machine CPU budget, and the budget states how many engines fit in it; the holder keys engines by root id and stops an engine only when it has neither a lease nor questions; `definition` receives pages (`limit`, `cursor`), as `uses` does.
3. **`9e5b2a965d`** — interface failure boundaries. Member: `Notices.fault` (callers in several app sections). Test: `packages/chat-ui/src/FeedRegions.svelte.test.ts`.
   > An exception in one effect freezes the whole window until reload: the app has no `<svelte:boundary>` at all; all components stand under one root. Place failure boundaries over independent units — a chat-feed row, shell areas (thread column, thread list, right area, overlays), and the root — with a visible failure view and reset. Every failure caught by a boundary and every unhandled window exception lands in the Errors list as a window failure: place, message, stack, ×N. Public-contract test: an exception in one feed row leaves the rest of the feed live, and the failure is visible in Errors.
4. **`4363df925c`** — law redelivery between checkouts. Member: the `WorkPlaces` service (threads, native-harness, external-harnesses). Test: `native-harness/places.itest.ts`.
   > When a thread switches between checkouts of one project, it receives the same law set again. Reconcile delivered law by content: never redeliver an identical set; deliver a differing one as a diff. The mutation admission must hold the law snapshot read before the assistant message that caused it, and refuse when the target checkout needs not-yet-delivered text.
5. **`c38ef21903`** — a folder without git. Member: `CheckoutRows`/`CheckoutState` (workspace, worktrees, landing, checkout-builds, the app). The commit's tests in `worktrees/` and in the app's checkout section.
   > A project folder without git shows in the worktree list as "unreadable", in red: reading such a folder's checkout ends in a git refusal and counts as a failure. The checkout-reading owner must tell "not a repository" apart from a read failure; the main row shows the folder with no branches and no error, while "New worktree" in it is unavailable with a cause.
6. **`930f215dc7`** — the Cursor interrupt profile. Member: `HarnessAdapter` (per-vendor implementations). Tests: `terminalInterrupt.stest.ts`, `adapter/promptScreen.test.ts`.
   > Cursor probes of 2026.10.19-6bbf2c4 showed: interrupt is Esc on an empty composer and a single Ctrl-C otherwise; a second Ctrl-C inside the declared exit window closes the CLI, so it is never pressed inside that window; an interrupt is confirmed only by a stop hook or the transcript end; the follow-up queue holds words as a draft. Bring the Cursor profile and the terminal transport's interrupt to this.
7. **`22b949177b`** — freeing ACP input claims. Member: `ThreadInbox.releaseInput` (threads, external-harnesses). Test: `protocolMethods.stest.ts`.
   > ACP: after UNSTEPPED with an open prompt, the compaction request leaves the claim at the turn end but stays among "in-flight" words and, together with a late steer, holds the follow-up. Release must return the actually dropped ids and hand their fate over with the same turn-end record; a system test confirms the next prompt.
8. **`932c65d56b`** — review findings by the operator's word. Member: `ThreadRunSettlements` and the turn-opening queue (`packages/agent`, server). Tests: `parity.stest.ts`, `protocolCancels.stest.ts`.
   > Fix the review findings by the operator's word: turn opening checks its queue in its own transaction; Enter waits for the words handed to the stopped turn; the follow-up wake goes first and once more after the stages; a stop before prompt closes the turn's own words along with it.
9. **`fd3f625ae5`** — operations without a graph. Member: `ThreadAggregate` and project admission (`packages/agent`, threads, invocation). Test: `http/admission.stest.ts`.
   > Operations that declared they do not read the graph still open the project graph when the call carries a scope. Admission opens no graph for them; ports derived from the graph are marked for declaration check; a thread stop reads the thread metadata row, not its whole history.
10. **`2060c2d7c8`** — the provider account source. Member: `ServedProvider` (app: providers and threads; server: providers). Tests: `spendWords.test.ts`, `spend.test.ts`, thread tests in the app.
    > One vendor's subscription and API key pay from one account source, and client and server pick signature rows by provider id. Give each provider its account source and read signature rows by it; the summarizer the server folds with the thread's own model is judged by the account the thread is pinned to, not the default account.
11. **`0e90dfeab3`** — stop first after socket open. Member: `ChatConnection` and thread stops (`packages/chat-ui`, the app). Tests: `ThreadSlot.svelte.test.ts`, `wire/liveFirst.test.ts`, the `chat-ui` test.
    > A thread stop made with a closed or reconnecting socket goes to the server first, ahead of all other commands and subscriptions. Sending waits for the answer or refusal of that same thread's model, reasoning, mode, command, and delegation writes made before the press; other threads' writes and unrelated settings do not hold it.
12. **`3a9785dc72`** — words of a revoked turn. Member: the serialized turn and the turn-status ending (`packages/agent`, native-harness, threads). The commit's tests in `packages/agent`.
    > A turn's words revoked by a stop are lost. Keep them on the turn itself and return them in the turn-status ending so they can be handed back to the operator.

Spare, in rule order: `daf78672e8` (a compaction-choice row with no estimate), then the rule continues from `9f5852bdbd`.

Rejected by the rule, newest first: `a447ce4baa`, `8721c48267`, `1cd98b2733`, `70b0bca68d`, `929c12577b`, `8823f75e68`, `b32b1508e2`, `7a6a046b29`, `4c12fe0f5b`, `526979e455`, `0d44c93c0a` — no tests; `aa050d0a39`, `3e53e92105`, `fb18efa7d0` — over 600 lines; `388ef0627d`, `3a79322baf`, `f68b154caf`, `9267524c3f`, `faeb19bf68`, `76ec0606bc`, `d26042d76f`, `0b93e91e89`, `573d71b9f3`, `21132e8e21`, `77ef18b292`, `b437a22552`, `4f3d4ba1ea` — over 15 files; `755f4a684c` — the `ChatStrings` member edit is signature-only; `2bc46fffae`, `404135a819`, `cc9000b3c8`, `305207258c`, `06e9a9e9bb` — a function or constant changes instead of a member; `1f8f95f689`, `dee861406a` — new code instead of existing-member behaviour; `097d670034`, `166539426b`, `254eaa9cfe`, `3bad0b22c6`, `6a3cd608dc`, `f68a4ac97a`, `6054a6ebc1`, `4ae3380c83`, `8098cc859f`, `a9427d35f3`, `57b35c9f5`, `fa0c424812`, `ffa82a5aca`, `27068bc93c`, `9ad09a4f4a`, `e791532bef`, `0e9c149ad8`, `70d74ebb67`, `dc4c88dc1f`, `cd69c4c951`, `537a71b99e`, `4f6c3c4ece`, `777735d781`, `773d26e356`, `912a1335eb`, `25f36d0d25` — the member lives in one module with one implementation; `3f4c4a0e8b` — needs probes of installed CLIs (S3). All other skipped commits have no non-test code or fewer than 10 lines.

## Stand

**Two sides means two agent definitions**, personal ones (`agents/` in the server data directory, available to agents by default), `extends: tagma`:

- `ab-nav`: `capabilities: [graph, files, shell, skills, resources, terminals, reflections, navigation]`;
- `ab-grep`: the same without `navigation`.

Preview of both drafts with `read_agent`: the prompt and its sections match; the tool catalog differs only in `definition` and `uses` (both eager, 1807 and 2028 schema characters), 123 vs 121 tools. Preview does not compare other tool descriptions — reconcile them in the first run against the recorded catalog. Removed on both sides: `agents` (children and their review would blur run tokens), `threads` and `peers` (a thread search would find the conversation that made the real edit), `mcp`, `plugins`, `web`, `sandbox`, `worktrees`, `speech`, `images`, `artifacts` — the tasks do not need them. Both sides have `grep`, `glob`, `read`, and `bash`, with no bans. Model and reasoning are the same on both sides, in `spawn_agent` (`provider`, `model`, `reasoning`).

**Worktrees.** Each run is its own runlith-project worktree on a new branch from the parent commit: `prepare_worktree {kind: new-branch, start: <parent>}` → `create_worktree`; `worktrees.setupRun` (`bun install --frozen-lockfile && …`) prepares it before the first turn. Names are neutral (`ab-<task>-<random suffix>`) so review never sees the side. The agent starts with `spawn_agent {agentId: ab-nav|ab-grep, worktree: <name>, task: <task text>}`; its work commit lands on that worktree's branch.

**Pair.** Both sides of a pair start at the same time, on one task, in one machine state. Before the pair starts, the experimenter asks one `uses` question in the navigation side's worktree so that worktree's snapshot is warm: the parent lags the engine base by hundreds of files, and before warm-up every place in them is "changed after the snapshot". No more than two pairs run at once (four agents): the machine needs their tests and typecheck.

**Capture** (after the run ends, through `read_thread`):

- full tokens — `select: runs`, sum of `usage.inputTokens` (cached and not) and `usage.outputTokens`; separately `usage.cacheReadInputTokens` and `usage.nonCachedInputTokens` for price;
- navigation calls — `select: entries`, `where toolName in [definition, uses]`, `group threadId`, `count`; likewise the `grep`, `glob`, and `bash` call counts;
- time — the run's `startedAt`/`finishedAt`;
- outcome — the commit's tests overlaid on the run branch, plus `bun run typecheck` of the affected packages;
- review — one reviewer per run under the project policy (`openai-oauth/gpt-6.1-sol xhigh`), same brief: the task text and the branch diff from the parent, with no side. The experimenter confirms or rejects each finding against the code; confirmed ones count.

**Decision leak.** A run that read the real commit (`git show`/`git log` with its sha, `git log --all` past the parent) or the task block that ended with that commit is marked from the thread records; its pair is excluded and repeated. Why a leak is possible is below.

## Pair count and estimate

**Criterion** (spec): the pair-median of the full-token ratio "with navigation / without" is ≤ 0.75; navigation is called in at least half of the with-navigation runs (all 12 tasks edit a shared member); the navigation side has no more confirmed review findings in total.

**Spread.** 2.7× matches the uncached-input spread of three code-nav runs in the A/B MVP (404k, 248k, and 150k; the grep side was 1.4×). The three-run range is ≈ 1.69σ, hence σ ≈ ln 2.7 / 1.69 ≈ 0.59 for the log of run tokens and σ ≈ 0.83 for the log of the pair ratio.

**Pairs: 36** — 12 tasks × 3 pairs. For the median to pass the 0.75 bar by chance no more than 5% of the time under no effect, the standard error of the ratio-log median (1.25·σ/√n) must be ≤ ln(1/0.75)/1.645 = 0.175, i.e. n ≥ 36. With a true 40% drop the rule then passes with ~90% probability, with 35% ~79%, with exactly 25% — 50%. The first 12 pairs run one per task; σ is recomputed from their ratios, and n = ⌈(1.25·1.645·σ/0.288)²⌉ = ⌈(7.16·σ)²⌉, within 24–48, with pairs dealt to tasks in a circle. The recompute takes only the spread, not the effect; the rule is recorded here before runs.

**Tokens per run.** Opening turns of threads that did three of these tasks: 14.2 M full input in 15 min (`c38ef21903`, Opus 5.5 high), 20.3 M in 20 min (`9e5b2a965d`, Opus 5.5 high), 3.5 + 4.7 M in 23 min (`4363df925c`, GPT-6.1 Sol xhigh); 91–99% of input is cache reads, output 10–50k. Planned estimate: 10 M full input (range 4–20 M), 98.5% from cache, 50k output. 72 runs are about 720 M full input (290–1440 M) and 3.6 M output. Review is 0.5–2.3 M input and 2–17k output (six GPT-6.1 Sol xhigh reviews while working on this spec); 72 reviews are about 90 M.

**API price** (Sonnet 5.5 and GPT-6.1 Sol: input $2, cache read $0.10, cache write $2.50, output $10 per million; Opus 5.5: $4, $0.20, $5, $20):

| run model | run | 72 runs | + 72 reviews (~$0.5) | total |
|---|---|---|---|---|
| Claude Sonnet 5.5 high | ~$1.9 | ~$135 ($55–270) | $36 | **~$170** ($90–310) |
| GPT-6.1 Sol high | ~$1.9 | ~$135 ($55–270) | $36 | ~$170 |
| Claude Opus 5.5 high | ~$3.7 | ~$270 ($110–540) | $36 | ~$310 ($150–580) |

The operator's accounts are subscriptions (`openai-oauth`), so the API price is a measure, not a bill. Full tokens do not depend on cache: a cache read enters `inputTokens` just like fresh input.

**Time.** A run is 15–25 min with tests; two pairs at once means 18 waves, about 8 h; with worktree preparation, V checks, and review — 9–11 h on the wall clock.

**Model.** Primary: Claude Sonnet 5.5 high — the cheapest able to edit code (same price as GPT-6.1 Sol), keeping the policy reviewer (GPT-6.1 Sol) in another model family. Second, when a performer as usually used in runlith is needed — Claude Opus 5.5 high, twice as expensive.

## What Tagma lacks for an honest A/B

**There is no way to place an agent onto a past-commit repository state together with navigation.**

- A worktree on an old commit receives the graph as the base checkout currently holds it (`create_worktree` delivers the current graph there): its specs and explanations already describe the new behaviour, and finished tasks name the decision commit;
- the shared git object store holds the decision commit itself — `git log --all` and `git show` will show it;
- a clone with cut history cannot be registered as a project: the repository key is the root commit (`projects/identity.ts`), and registration refuses `duplicate-root`;
- a sandbox (`prepare_sandbox` from a commit) cuts both graph and git, but navigation answers only in a registered checkout (`navigation/operations.ts`, the question place is `CheckoutPlaces.placeOf`), so the navigation side has nothing to navigate with in a sandbox.

The leak is symmetric and gives no side an advantage, but it can remove the need to find edit places on both sides and thus blur the effect. The stand above catches it from the thread records and repeats the pair. The clean fix is a door placing a worktree onto a commit with that same commit's graph and no later objects; that is the operator's decision.

Everything else exists: the agent definition narrows capabilities by exactly `navigation`, worktrees prepare themselves, `read_thread` returns tokens, time, and calls. Each worktree creation is an act that in review mode asks the operator (72 times) — the experimenter thread's mode is the operator's choice.
