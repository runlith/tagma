---
id: 01a0de42-a34b-71f3-803b-b3e38bdd6f75
title: Every commit into a Tagma checkout is judged by its enforced rules — `git commit` through a `pre-commit` hook, humans with an explicit recorded override — and `direction` sees packages, keeps debt per file, and a provable tightening does not ask
ord: 148
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**Outcome.** "The gate passed" means what it says, for every commit into a Tagma checkout:
1. A commit made with `git commit` — from an agent's shell, a terminal, `checkout_commit` or the operator's own editor — is judged by the same enforced rules `submit_work` runs, through `tagma check` in a `pre-commit` hook Tagma installs.
2. An agent is refused like at `submit_work`, with no way around it. A human (no Tagma session in the environment) is refused by default too, but may land the commit through an explicit override; what the override let in is recorded against that person as an escape, never silently becomes the base.
3. `direction` judges imports between workspace packages (`@runlith/*`), not only relative ones.
4. `direction` debt covers only the files that stood in debt: a new file importing across the same floor pair is refused.
5. `enforce_rule` asks the operator only for a real loosening; a change that provably tightens a rule is written without asking.

**Problem.** Found by a four-agent adversarial review of the enforcement engine (this thread, 2026-09-26) and confirmed in code:
- Only `submit_work` and `merge_worktree` give a rule a tree to judge (34501c09); `checkout_commit`, `git commit` from bash and the operator's own commits are never judged, and Tagma installs no git hook (judged clones even run with `core.hooksPath=/dev/null`, `enforcement/workdirs.ts`).
- The JS adapter's `resolve` reads only relative specifiers (`code-facts/src/languages/js/resolve.ts`), so `direction` never sees `@runlith/*` crossings; the monorepo's package boundary stays in `package-boundary` tests nobody runs.
- `direction`'s fingerprint is the floor pair `from -> to` (`inspection/src/node/direction.ts`), and `inspection/src/node/judge.ts` subtracts base and debt by fingerprint: one debt pair licenses any number of new imports of that pair (b5d2b84b states it). Every enforced rule in runlith has 0 debt today, so nothing leaks now.
- `enforce.ts#loosened` counts any change of the inspection as a loosening (5134ddcf), so adding a floor entry for a new directory, or narrowing `allows`, asks the operator; moving domains into modules would queue a question per step.

**What holds now.** Five rules at gate before `submit_work` and `merge_worktree`: f49f228f, 0d2c66a9, 39817e41, 925aed1c, 8183e6ef, all at 0 debt. `loads` already resolves workspace packages through `code-facts/js/workspace` and fingerprints per selected file. Agent commands run with `TAGMA_SESSION_GRANT` (`protocol/grant.ts`) in their environment; a human terminal outside Tagma does not.

**Target.**
- **Subject for a staged commit.** A new check subject: the tree the index holds (`git write-tree` over the real index, never mutating it) against HEAD, with the committer's identity: the Tagma session from the grant when present, otherwise the operator as a human. `checkout_commit` offers the same subject to the rule-check port before it commits, like `submit_work` does, so a refusal commits nothing. A trigger for rules: `{ op: "git_commit", phase: "before" }` — or the rules' existing `submit_work` before trigger reused; the builder chooses, and the choice is one sentence in the claims. Existing rules must end up judging `git commit` without the operator re-enforcing each.
- **`tagma check`.** A CLI verb calling `check_rules` over the staged tree (plus `--all` over HEAD), printing violations and exiting non-zero on a gate refusal. Its answer names each violation, the rule, the file and line and the unblock.
- **The hook.** Tagma installs a `pre-commit` hook into every project checkout it registers (and each worktree it creates), idempotently, chaining any hook already there rather than replacing it, and never where `core.hooksPath` points outside the repository without saying so. The hook runs `tagma check`. Server unreachable: the hook warns that nothing was judged and lets the commit through (a commit must never require Tagma to be running). Agent session in the environment: a refusal is final; `--no-verify` from an agent's shell is itself refused by the command road (the shell's git invocation is inspected) or, if that is not reliably possible, the landed commit is recorded as an escape against that session and told to it — the builder picks the stronger road that is honest, and the limitation, if any, is a claim.
- **Human override.** `TAGMA_ALLOW=1 git commit …` (or `--no-verify`) lands; `tagma check` records what it let in as escapes held by the operator, visible where escapes are read (`rule-escaped`).
- **Packages in `direction`.** `direction` resolves a workspace specifier through the same workspace reader `loads` uses, onto the file its `exports` map names, and judges it against the floor table when that file lies under `base`. A specifier outside the workspace stays unjudged-free (not a crossing). This lets a floor table name package directories (`packages/llm/`, `packages/agent/`) and so replace `package-boundary`'s direction checks later.
- **File-level fingerprint.** `direction` fingerprints `<file relative to base> -> <target floor entry>`. Documents enforced with pair fingerprints: their debt is re-measured into file fingerprints the next time they are enforced; until then an old pair entry still subtracts (read old rows), and the delivered line says the debt is pair-grained. runlith's rules carry no debt, so they migrate by a plain re-measure.
- **Tightening does not ask.** Each builtin declares whether a new parameter set is provably at least as strict as the old one (`tightens(old, new)`): `direction` — same `base`, `reads` not narrower, `siblings` not looser, every old floor entry still on the same or a lower floor relative to every other old entry, excludes not wider, extensions not fewer; `loads` — `refuses` ⊇ old, `allows` ⊆ old, `from` ⊇ old, same `reads`/`conditions` or wider; `reexports` — `allows` ⊆ old, excludes ⊆ old, extensions ⊇ old. Anything not provably tighter stays a loosening and asks. A program's change still always asks.

**Owners.** Staged subject, `checkout_commit` wiring, hook installation, escape recording: `apps/tagma/server/src/enforcement/` with the operation bodies offering the subject only (af96fc15). `tagma check`: `apps/tagma/server/src/cli/`. Package resolution: `packages/code-facts` (JS adapter) and `apps/tagma/inspection/src/node/direction.ts`. Fingerprint and `tightens`: `apps/tagma/inspection`. `loosened`: `enforcement/enforce.ts` asking the builtin.

**Rejected.** Exempting humans entirely: their violations would silently become the base every later landing is measured against, and agents copy what stands. A CI-only check: runlith has no CI on `main`, and a CI verdict arrives after the commit is shared. Blocking a human with no override: a commit must stay possible when the operator knowingly decides.

**Acceptance.**
- In a fixture repo with a gate rule: `git commit` of a violation with the grant set is refused and nothing is committed; without the grant it is refused, and with `TAGMA_ALLOW=1` it lands and an escape held by the operator stands; with the server stopped it lands with a warning.
- `checkout_commit` of a violation is refused like `submit_work`.
- An existing hook keeps running after installation; re-installing adds nothing.
- `direction` over runlith with a package-level floor table reports a real `@runlith/*` upward import, and f49f228f still reads 0.
- A rule with debt `a.ts -> X` refuses a new `b.ts` importing X across the same pair.
- Adding a floor entry for a new directory, or removing an `allows` entry, writes without a permission question; widening `allows` still asks.
- Every enforced rule in runlith still reads 0 after migration.

**Claims and tasks touched.** 34501c09 (subjects), 4f53fa69 (peer lines — unchanged for the staged subject: a staged file holds the committer's lines as the index holds them), 5134ddcf (loosening), b5d2b84b (pair debt), the `direction` limitations text and area, 1bd3265a (hook path must not load parsers into the CLI entry). Builders revise them from the code.

**Order.** Two builders in parallel on disjoint files: (A) inspection/code-facts — package resolution, file fingerprint, `tightens`, and `enforce.ts#loosened` asking it; (B) server — staged subject, `checkout_commit`, `tagma check`, hook installation and override, escape recording. B uses whatever `direction` A lands; neither edits the other's files.

**Contract.** `tagma check` is a new CLI verb; exit codes: 0 clean or unjudged-allowed, 1 refused, 2 could not judge. The rule document gains nothing mandatory; `tightens` is internal. **Stored data.** Old pair fingerprints are read as before until re-measured; no migration of tables unless escape recording needs a holder kind for "operator" (then: a migration adding it, old rows unchanged). **Permissions.** The hook runs as whoever commits; recording an operator escape needs no permission; installing the hook into a checkout is a write the project registration already authorizes, announced once. **Long-lived things.** The hook file lives in `.git/hooks` (or the repo's `core.hooksPath`); removal of a project leaves a hook that finds no server and passes with a warning — removal uninstalls it. **Resources.** A staged check costs what a landing check costs (milliseconds, reads only the changed files). **Rollout.** Running agents see refusals at `git commit` from the moment the hook is installed. **Failures.** Server down or slow: the hook never blocks on the server — it passes with a warning after the CLI's connect failure (no hook-side timeout invented; the CLI's own connect failure decides). **Observability.** The trigger span `git_commit.before` (or the reused one) with verdict; `tagma check` output; escapes list.
