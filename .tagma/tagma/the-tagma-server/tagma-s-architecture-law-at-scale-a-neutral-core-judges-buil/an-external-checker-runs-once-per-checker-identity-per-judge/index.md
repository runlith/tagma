---
id: 01a0f476-04de-7739-9ff5-ba99d11108eb
title: An external checker runs once per checker identity per judged tree, its readings routed to rules by binding key, keyed by semantic fingerprints with counts, and never silenced by a suppression the law did not accept
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Part of [[9140c692]]. It fixes how a rule names an external checker's check, how one run serves many rules, what a checker must answer, how a violation keeps its identity across edits, and why a suppression comment cannot open a gate.

## 1. Outcome

- A rule's policy names one or more check bindings, each `{ builtin, params }` or `{ runner, id, params?, files? }`, where `runner` is a descriptor the project declares once; a norm passes only when every binding it names was judged.
- In one judgement every checker runs once per checker identity over the judged tree, whatever number of rules it serves; its readings are routed to rules by binding key.
- A violation is keyed by a semantic locator the check supplies; duplicates are counted, never merged, and a count never grows unnoticed.
- A suppression comment — old or new — never hides a governed violation from a gate.
- Every road — builtin, linter, program — is judged by the same arithmetic; a `value` is a measure recorded with the debt and never judged against it.

## 2. Problem, with evidence

- A program is one process per rule, run one rule after another: ten oxlint programs cost 3–4 s per commit, one grouped run 0.3–0.4 s (the operator's benchmark, one machine).
- A program's debt is subtracted without comparing `value`, and SARIF results without `partialFingerprints` merge duplicates (M9).
- oxlint honours inline disables with no flag to ignore them (M7).
- `command` sits inline in each rule's document, so two rules on one tool cannot be recognized as one run.

## 3. What holds now

- The program contract 1 ([[50467aad]]): JSON on stdin with `paths`, `files`, `baseFiles`; `tagma` or `sarif` output; a SARIF program runs twice, once per side ([[18a19183]], [[59bbc3b6]]).
- A builtin's reading compares a violation first against the base side's standing value, then against the debt (`judgeReadings`).

## 4. Target model

### 4.1 Runner descriptors, checks and norms

- A **runner descriptor** is declared once in `runners.json` inside the project's programs directory ([[833122ed]]) — versioned, reviewed like code:
  ```json
  { "version": 1, "runners": [
    { "id": "law-oxlint", "adapter": "oxlint", "config": "checks/law.oxlintrc.json",
      "pins": ["checks/lint/**"], "packages": ["oxlint"], "runtime": "bun" },
    { "id": "runlith-law", "adapter": "program", "argv": ["bun", "checks/law/main.ts"],
      "layout": "program", "pins": ["checks/law/**"], "packages": ["@runlith/code-facts", "effect"], "runtime": "bun" }
  ] }
  ```
  `adapter` names a Tagma runner adapter; `config` or `argv` is what it runs; `pins`, `packages` and `runtime` declare the checker's closure ([[b2965d21]]). A binding's `params` are its rule's options, and the rule is their only home: the oxlint and ESLint adapters write the linter's config for each run from the bound rules and their params, and a native config, when the descriptor names one, supplies only the environment — plugins, parsers, settings — never a rule's switch or options. A checker with no options per rule (Ruff, ast-grep, Semgrep) refuses params.
- A **check** is one id inside a runner's output (`shop/injectable-in-controller`, `E501`, `boundary-imports`), or a builtin with parameters.
- A **norm** is a #rule; its policy holds a non-empty list of check bindings with its own reach, strictness, triggers and one debt ledger:
  ```json
  "checks": [
    { "runner": "law-oxlint", "id": "runlith/reexports", "files": ["**/*.ts", "**/*.tsx"] },
    { "runner": "law-svelte", "id": "runlith/reexports", "files": ["**/*.svelte"] }
  ]
  ```
  `files` narrows a binding within the norm's reach, so complementary checkers cover one norm — here oxlint for scripts and ESLint with the Svelte parser for components. The norm is judged only when every binding it names answered a complete reading; one failed binding fails the norm's inspection. Keys are namespaced by binding (`<runner>:<id> …`), so two checkers never collide in the one ledger. Many norms may share one runner and stay independent.

### 4.2 One run per checker identity

- The planner takes the checks in play, gives each an invocation-local **binding key** — the check id, its effective parameters and its reach — and groups the keys by checker identity. Norms whose keys are identical share one reading, routed to each rule.
- Each group runs once per judged tree. The rule's findings outside its reach are dropped; findings for ids no rule names are dropped.

| Layout | For | Runs per judgement |
|---|---|---|
| `files` | a check that decides a file from its own text, where config and dependency resolution are the same in a scratch layout (explicit config, `--disable-nested-config`, nothing read beyond the file); the adapter declares it per check and proves it by a conformance test | **one**: the changed paths' texts of both sides are laid out in `scratch/{tree,base}/<path>` and the readings split by root |
| `program` | a project program speaking contract 2 | **one** per program identity, carrying all its keys; both sides in the input |
| `tree` | a whole-package, type-aware or compiler-driven checker (golangci, clippy, eslint with types) | one when a complete raw reading of the base for this identity and the covered inputs is cached; otherwise an explicit base preparation (two). Such adapters ship only together with that cache ([[8fe9d0a8]]); until then they stand at merge or watch and are promised no single run |

- **Raw readings are cached, never verdicts**, so a change of debt or strictness reruns nothing. Key: checker identity, resolver inputs and input content. Completeness is recorded per key and covered set; a failed or truncated run fills nothing.

### 4.3 Contract 2

- Input: `{ contract: 2, request, checker, keys: [{ key, id, params, reach }], root, tree, base, sides: [{ side, paths, files }], facts?, workdir? }` — `request` is the invocation's own id, `checker` the identity digest it runs under.
- Output: `{ contract: 2, request, tree, base, checker, run: { tool, version, capabilities }, readings: [{ key, side, covered, findings: [{ fingerprint, fingerprintVersion, path, line?, message, value? }], unjudged }], failure? }`. A program echoes `request`, `tree`, `base` and `checker` from its input; for a linter adapter, the adapter attaches them from the invocation it made itself. A reading whose echo differs from the request, or a cached reading whose stored echo differs from the key it is asked for, is refused.
- `covered` is an explicit list of the paths read, or `{ scope: "reach" }` for a reading of the key's whole reach.
- A successful answer holds exactly one reading per requested key and required side. A missing, duplicate, unknown, wrong-tree or wrong-version reading fails the inspection; it is never zero findings.
- SARIF 2.1.0 is decoded where the checker emits it (oxlint, ruff, ast-grep, semgrep, eslint through its formatter, golangci); clippy through Cargo's JSON; each adapter maps its output onto readings.
- The adapter declares what each exit code means (oxlint exits 1 when it finds something). An unknown exit, a stop at the command rules' time, output that does not decode or is cut, or an unavailable tool is `inspection-failed` at gate and `watched` at watch — never clean.
- Contract 1 stays readable within the support window of [[172759d0]].

### 4.4 Keys, counts and values

- **Tier (a):** the check supplies a semantic locator — `path + symbol + form + site`, `<file> -> <entry>`.
- **Tier (b):** SARIF `partialFingerprints`, only where the adapter declares their unit stable for that tool version.
- **Tier (c):** a check with no locator (ruff `E501`) is watch-only by default. It may gate only if the operator adopts a **count budget** as its unit: one key per `(check, file)` whose `value` is the count.
- No source-order ordinal and no message with its digits folded serves as identity.
- **Duplicates:** a reading counts the occurrences of each key. The ledger holds `{ fingerprint, owner, count, value? }`; `count` defaults to 1 and is the number of identical-key occurrences adopted as debt. `value` stays the check's metric; a check that emits `value` emits unique keys, and a reading with a duplicated valued key fails.
- **Arithmetic, per key:** when the complete base reading covers the key's path, the base's count is the allowance and the debt is not consulted, as `judgeReadings` does today; otherwise — a whole-reach measurement, a proven move — the debt's count is. New = the built count above the allowance; a value moving either way is never new. Base and debt are overlapping evidence, never added: a base of 2 with a debt of 2 lets a built 3 through as one new, never as four allowed.
- **Retirement:** the re-measure driver may lower a debt entry's count to what a complete reading measured, never raise it; raising is an absorb through `enforce_rule`. The driver rewrites the entry's value to what the reading measured, up or down. Because the complete base reading takes precedence, a count lowered by a landing cannot be reopened by the next change before the driver runs: debt 3, base now 1, built 2 is one new.
- **Moves:** debt and base counts follow a renamed file only on exact content identity or a check-specific subject match; a file git pairs by similarity inherits nothing.
- **Re-keying:** a tool upgrade that changes keys moves debt through an adoption act — a proven one-to-one map writes without asking; anything else asks. Equal counts prove nothing.

### 4.5 Suppressions

Withdrawn by [[16819c00]]: a checker honours its own suppression comments.

Each adapter declares one of three capabilities for a gated check:
- turn directives off by flag (`ruff --ignore-noqa`, `eslint --no-inline-config`);
- read unsuppressed: in the `files` layout Tagma blanks **every** governed directive in the scratch copies — old and new, `disable`/`enable` ranges included — through the checker's real comment grammar, spaces in place of the text so lines and columns stay; this is a view of execution, not an edit, and the adapter's conformance test proves the result equals the unsuppressed reading (for oxlint 1.86 this is the only road, M7);
- report the coverage a suppression affects as `unjudged`, which refuses at gate.

Suppressions by attribute or config (`#[allow]`, per-file ignores) must be exposed by the adapter, or the check cannot gate. The only permission to skip a governed site is an allowance in the policy's canonical home ([[172759d0]]). At adoption, a standing suppression becomes debt or an allowance — never a silent right.

### 4.6 What Tagma adds to a linter's own config

Only new violations refuse; debt is owned and its counts only shrink; the norm reaches the agent before it writes; a peer's line is carried, not refused; loosening waits for the operator; escapes are recorded; one verdict spans every checker and language; the same law runs in CI.

### 4.7 Routes per ecosystem

- JavaScript/TypeScript: oxlint with JS plugins; ESLint where a Svelte or Vue processor, an ESLint-only plugin or a type-aware rule is needed.
- Python: ruff's own rules; custom law through ast-grep or semgrep YAML, or a program (import-linter wrapped in contract 2) — Ruff supports no custom rules (M13).
- Go: golangci-lint with `go/analysis` analyzers through its module plugins, a `tree` layout.
- Rust: clippy through Cargo JSON; custom lints through dylint, a `tree` layout.
- Any language: ast-grep (`scan --format sarif --filter <ids>` runs a chosen subset in one invocation, M13) and semgrep.

## 5. Owners and boundaries

- `@tagma/inspection/core` owns keys, counts, the arithmetic and contract 2's schemas.
- `@tagma/inspection/runners/<tool>` own layout, decoding, exit codes, suppression grammar and their conformance tests.
- `enforcement/` owns planning, grouping and the raw-reading cache, and runs checkers through the `ProgramRoad` port declared in `executions/contract/service/programs` and filled by `executions/` ([[bfe5f544]]).
- The project owns `runners.json`, the environment configs, plugins and programs; a rule's options are its bindings' params.

## 6. Rejected alternatives

- **One process per rule**: ten times the cost for the same readings (the benchmark).
- **One wrapper that launches the tool twice and calls it one run**: it hides the cost the operator asked to cut.
- **Collapsing all rules of a tool into one graph rule to batch it**: it merges independent scope, strictness and debt.
- **A digit-folded message with an ordinal as identity**: an insertion before indebted sites moves the permission; a fixed site A and a new site B with the same message would let B inherit A's debt.
- **Allowances as inline suppressions**: any agent could silence a gate (M7).
- **ESLint as the default JavaScript runner**: 4.4–5.4 s against 0.56–0.59 s over 1,099 files; kept for what only it can read.

## 7. Acceptance criteria

- In a fixture, ten #rules on one `law-oxlint` descriptor judge a landing with one oxlint process for both sides; the span shows the process count and time per group.
- Two norms using one program check with different parameters and reaches receive distinct readings in one run; a missing or duplicated reading, or one whose echoed `request`, tree or checker differs, refuses `inspection-failed`.
- A norm bound to an oxlint check for scripts and an ESLint check for `.svelte` fails its inspection when either binding fails, and keeps one ledger.
- A base holding two equal-key violations with a debt of two, and a built side holding three, yields one new; a built side of one, then a later change back to two, yields one new.
- A program's `value` above its base or debt refuses (M9 closed).
- An `oxlint-disable` comment above a governed violation, whether it stood before or is new, does not hide it from the gate.
- An adapter's conformance suite (exit codes, suppression capability, `files` equivalence, fingerprint stability) passes before any of its checks can gate.

## 8. What becomes of the claims and tasks it touches

- Area [[5bc7cd8a]]: claims [[59bbc3b6]], [[18a19183]] and [[c0029022]] are rewritten from the code for contract 2 and the key tiers; the rest are re-read.
- Claim [[bc68cbda]]: gains counts and the tiers.
- Claims [[b5d2b84b]] and [[cf2e7a88]]: re-read against the grouped run.

## 9. Order of building

Contract 2 with keys, counts and values for every road; the planner and grouping of programs; the `oxlint` adapter with its conformance suite; then `ruff`, `ast-grep`, `semgrep`; `tree` adapters last, with the base cache.

## Spec-list questions

This decision answers 1–9.
- 10 Contract: contract 2 is new; contract 1 is read within the support window. `fingerprintVersion` travels with every finding, the adapter's capability version with every run; an unknown version fails the inspection.
- 11 Stored data: debt entries gain `count`, 1 for every v1 entry unless a deliberate adoption measured more.
- 13 Long-lived things: scratch layouts per judgement, removed when it ends; the raw-reading cache, bounded as 14 says.
- 14 Bounded resources: judgements queue in today's inspection lanes, one ask in flight each ([[de916dff]]), and programs queue on the command road under the machine's admission ([[555f685a]]); one process per group; process and thread counts derived from the machine's capacity (rule [[fe83acfa]]), never above three here (rule [[5ca40326]]); time from the command rules ([[6b14a1ad]]); output up to the execution host's bound, and a cut output fails the inspection; the raw-reading cache holds a byte budget the enforcement store derives from the disk it stands on and evicts only entries no running judgement leases.
- 15 Rollout: program rules keep contract 1 until each is re-adopted on a descriptor.
- 16 Failures: a crashed, stopped or undecodable run fails the inspection at gate and is watched at watch; a restart mid-judgement commits nothing.
- 17 Observability: spans per stage — planning, queue, preparation, tool start, work, reduction; process count per judgement; cache hits and invalidations; `read_inspections` shows each rule's runner group and each adapter's capabilities.
- out: 12 — who may adopt or loosen is [[172759d0]]'s.
