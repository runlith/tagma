---
id: 01a0d4db-9d34-7461-807d-8775f5648cf9
title: "Tagma holds a project's architecture as law it measures: declared by the project, delivered at the write, enforced at landing, judged in the background"
ord: 32
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Tagma keeps knowledge as measured claims; this idea extends the same move to architecture. A project declares the architecture it wants, as much or as little of it as it wants. Tagma delivers that law to the agent where it writes, enforces the mechanical part when the work lands, and spends agents' judgement on the rest. The engine carries no opinion: every opinion is content the project installs or writes.

## Why

Agents write fast and optimise locally. Each reasonable edit adds one line of wiring to a shared file, and the sum is a choke point. A 12-reviewer reading of this repository on 2026-09-24 measured it:
- `Stack.ts` was edited for other features' wiring in 10 of 15 sampled commits;
- one domain is spread over 9–14 server directories;
- Tagma's own server exports 141 `Tagma*` identifiers;
- a floor debt went 8 → 0 → 7 → 4 with nothing holding it;
- an upward import (`worktrees/WorktreeSetups.ts` → `terminals/`) landed unnoticed, and a session repaired it by hand hours later.

The law against all of it existed only as prose — the `AGENTS.md` written for external harnesses — or as per-package tests (`packages/package-boundary`) that nothing runs automatically. The graph described these weaknesses truthfully — [[8779de7a]] is verified — and prevented none of them. It is memory, not a regulator.

Books assume architecture lives in people's heads and is passed on by review and culture. Agents have neither memory between sessions nor culture, and there are dozens of them. Writing and refactoring became cheap; coordination, verification time and consistency became expensive. So the principles stay — ownership, direction, bounded contexts, contracts — and the carrier changes: the machine holds the architecture, delivers it where the decision is made, and enforces it at landing.

## Four parts

1. **Law.** Rules with an executable inspection, a strictness, a run point and a debt that only shrinks. Narrow, cheap, independent of any model budget, and the only part that may refuse.
2. **Signals.** Measured facts that point where to look and refuse nothing:
   - size;
   - edits for the file's own subject versus other features' wiring;
   - co-change and `owner-spread`;
   - a class named like its own directory, or a bare domain noun as an owner's name;
   - look-alike symbols across modules.
3. **Judgement.** Reviewer agents with the project's own lenses and a memory of past verdicts. They decide what mechanics cannot: whether a large file is one owner or ten, whether a name tells the truth, whether two mechanisms are one. A recurring verdict is promoted to law.
4. **Staffing.** Which agents, models and budget buy the judgement today. A separate system-level tool with its own UI; out of this idea.

The cycle: signal → judgement → decision → refactoring task → law that keeps the result. Refactoring becomes a continuous background process instead of a heroic project.

## Principles

- **The engine is neutral.** The core knows rules, inspections, strictness, run points, debt and the gates. What counts as good architecture — floors, naming, module shape — is content: a project's own rules, or a preset installed as a catalog the way `code-project` is installed today. A senior who wants one-word class names writes that rule and gets it enforced exactly as strictly as any other. The test of neutrality: two contradicting presets on one engine, without a code change.
- **Nothing by default.** A project that declares nothing sees Tagma as it is today, and commits as fast.
- **Strictness is per rule, never per project.** Note is delivered only. Watch is measured and reported. Gate means a new violation refuses.
- **A gate needs a working inspection.** Prose can never refuse.
- **Only the new is refused.** What stands at enforcement becomes debt with an owner, so no project starts red. Debt only shrinks, and a violation that gets in anyway is recorded until it is fixed.
- **A legitimate violation means the rule is too wide.** The way out is narrowing the rule through a decision, never a list of exceptions.
- **A landing stays fast.** Every inspection at landing, together, fits a landing budget of tens of seconds, never minutes. The budget is a project setting; the operator's default is 30 seconds. Anything slower runs at a worktree merge or at watch.
- **Rules earn their place.** A rule that never fires, or fires falsely, is visible as such; the set can shrink.
- **The agent does the bureaucracy.** The operator talks; the agent writes the model, the rules and their inspections.
- **One engine, many doors.** The same rules and inspections run:
  - at landing, and at a worktree merge;
  - before landing on request;
  - over a plan before any code exists;
  - in the background;
  - headless in CI (`tagma check`), so commits made outside Tagma are held too.
- **Global knowledge, local delivery.** Background architecture agents keep the module map, the vocabulary and the verdicts. A task agent receives only the slice its work touches: in the spec brief, when it opens a file, and in the reviewer's architecture delta of a diff. Good module boundaries are what make local reasoning sufficient, which is why architecture matters more with agents than with people.

## Where inspections come from

A rule is the norm: text, an inspection, a strictness, a run point and a debt. The inspection is what runs. Inspections come in three tiers, the way a linter has core rules, shareable plugins and local rules. The tiers keep a project from growing a private pile of scripts.

1. **Builtins, shipped by Tagma, configured by parameters.** They cover what most projects want without code:
   - `imports`: allow and deny by path pattern, and floors (`direction`);
   - `names`: a pattern per declaration kind, plus forbidden words;
   - `size`: lines per file by glob;
   - `cycles`;
   - `modules`: imports against the `#module` map and its `depends-on`;
   - `patterns`: declarative code shapes, with ast-grep over tree-sitter as the candidate.

   Every convention a builtin applies is a parameter: which files it reads, what counts as a crossing, which import spellings count. What it cannot resolve it names as unjudged. Builtins read facts — imports, declarations, names — from one facts engine per language. TypeScript comes first; tree-sitter reaches the rest. A measuring inspection stores the measured value in its debt entry, so a file already over a limit may not get worse.
2. **Packs, installed like a catalog.** A pack bundles rules with their inspections, default parameters and default strictness (watch); the lenses and vocabulary its judgement uses; and the programs its command inspections run. It is installed through the catalog installer, so it carries a versioned release, upgrades in place, keeps local edits and names conflicts ([[cfa23151]]). It travels as a git repository or a package. Tagma ships first-party packs — module boundaries, role names, one per popular stack — and anyone can publish one. A project installs two or three and overrides their parameters locally.
3. **Project inspections: a program in any language** ([[50467aad]]). It speaks one JSON-in, violations-out contract, runs on the execution host under the triggering caller's authority, and may emit SARIF, so existing tools plug in unchanged (ESLint, clippy, ArchUnit, import-linter, semgrep). An SDK — TypeScript first, Rust next — reads the input, reads files at the judged tree and its base, queries the facts engine and emits fingerprinted violations, so a custom inspection is a few dozen lines. One that proves useful beyond one project moves into a pack.

## Tests

**Operator's ruling (2026-09-26), standing until the operator reopens it:** Tagma's enforcement judges architecture only. No typecheck and no test runs at `submit_work`, a `git commit` or a merge — not at gate, not at watch; checking them is the working agent's own job. The rest of this section is an unaccepted possibility.

How tests are written is architecture, and it lives in the same law.

1. **Layers are defined by what a test may touch, not by speed.**
   - **Unit:** values and in-memory fakes of ports; no disk, process, git, network, real store or sleep.
   - **Integration:** one owner's contract against a real resource, in an isolated root with a fake home.
   - **System:** the product assembled whole.

   Speed follows from the layer. It is measured and held by a budget, never used to define the layer.
2. **A layer is a project rule.** Its inspection is the project's layer runner with a runtime resource guard, speaking the program contract. Its violations are fingerprinted as test file × resource kind. Its time budget is a measuring inspection whose value sits in the debt. Today's mislabelled tests are debt with a ratchet: runlith's server has 166 of 362 `.test.ts` files touching real resources.
3. **Where tests run is the rule's run point, and landing is never the default.**
   - **work:** `inspect_work`, run by the agent itself.
   - **watch:** a background run after landing, with red reported to the author through the existing delivery.
   - **merge:** the worktree merge, where the full run belongs.

   A project may put a layer at landing only by an explicit rule, inside the landing budget, and only once results are cached.
4. **Affected tests and a cache.** The facts engine answers which tests an edit reaches, through the reverse import closure. A change outside the import graph — a migration, a fixture read by path, a preload, a manifest — falls back to the whole package. A result cache keyed by the content of a test's inputs lets a second agent skip a test whose inputs nobody changed. On one machine with dozens of sessions, the suite's cost grows with sessions, not with code. Chronically red tests are debt with an owner, and a new failure is red.
5. **A test's cost is a signal.** A unit test that has to stand up the whole stack shows a module boundary that does not exist in the code. Cost is measured as processor time or time in isolation, because wall-clock time beside twenty neighbours measures the neighbours.
6. **A run never hangs forever.** A layer run through Tagma goes as an admitted command, whose host already bounds time and ends process trees. Finding where a stuck worker stood is the layer runner's own job.

## The agent that sets it up

Nobody writes rules, parameters or inspections by hand. The operator tells an agent what the project should hold ("the UI never reaches the database", "an owner is named by its role"), and a specialised agent turns that into law. Built as the builtin `rules` agent ([[26598301]]): it measures with `check_rules`, proposes, and runs `enforce_rule` on the operator's word, reading its expertise from `read_inspections` rather than its prompt ([[14725e18]]). Packs, once they exist, are catalogs it reads the same way.

## What Tagma already has, and what is missing

**Present:**
- `#module` with `depends-on`, measured by the `dependency-undeclared` finding;
- `owner-spread`;
- `#rule` delivered by reach;
- catalogs;
- `GateRefusal` with `unblock`;
- `#proposal` and the zone reviewer;
- tasks, agents and workflows;
- `zone-cutter`;
- the execution host's bounded commands;
- the worktree merge check;
- the `rules` agent that sets it up, with `read_inspections` and `check_rules` ([[26598301]]).

**Missing:**
- a rule's inspection, strictness and run point;
- debt with a ratchet, and the recording of escapes;
- the landing and merge gates, and a headless check;
- the plan-as-facts inspection;
- test layers, and the affected-test cache;
- judgement lenses aimed at code rather than at the graph;
- the architecture delta of a diff;
- import readers beyond TypeScript.

## Order

Every slice builds into the component map [[ae56a980]]: a facts kit, a pure judgement package, and the server's enforcement module.

1. [[be584b76]] — enforcement with one builtin inspection (import direction), debt, `enforce_rule`, the three reads, the gates at landing and at merge, the re-measure driver; runlith's server floors as the first rule.
2. [[50467aad]] — project inspections as programs in any language, SARIF included, together with the agent that sets it up.
3. [[8e7c936b]] — test layers: resource contracts guarded by the project's layer runner, time budgets, today's mislabelled tests renamed to integration, the `work` run point.
4. Affected tests and the result cache, chronic failures as debt.
5. The core builtins — `imports` allow and deny, `names`, `size`, `cycles`, `modules` — and the neutrality test.
6. Packs through the catalog installer, the first-party packs, and the SDK.
7. Migrating the rest of `package-boundary` package by package, after which its test drivers die.
8. Global inspections in the background; `tagma check` headless for CI and hooks.
9. Facts from a plan: checking a decision's placement section.
10. Judgement: lenses as content, the architecture delta, the fold of verdicts into law.
11. The facts engine beyond TypeScript, through tree-sitter.

## Open questions

- Language coverage: resolving an import to a file differs per language (Python packages, `use crate::`, Go modules).
- A stable identity of a violation across edits, for inspections finer than a directory crossing.
- Where debt lives once it holds hundreds of entries.
- The cost of a landing on a repository of a million lines.
- Noise: five sharp inspections beat fifty noisy ones, and the graph already pays for a findings stream nobody drains.
- Graph tests: runlith's store is SQL in a child process, so every graph test is integration by definition. Is a shared stand per file with rollback enough, or does the store need an in-process implementation behind its port — two implementations that must agree in everything?
