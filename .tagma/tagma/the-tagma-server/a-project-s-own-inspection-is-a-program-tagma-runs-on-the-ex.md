---
id: 01a0d4e4-fbe8-775c-8493-93f850467aad
title: A project's own inspection is a program Tagma runs on the execution host under the triggering caller, speaking one JSON-in, violations-out contract
ord: 34
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0d4db-9d34-7461-807d-8775f5648cf9
---
Second slice of [[f5648cf9]], built on [[be584b76]]. A rule's inspection may be a program of the project, written in any language. Tagma runs it on the execution host over the judged tree and its base, and feeds its violations into the same debt, gate and driver as a builtin's.

## 1. Observable outcome

- `enforce_rule` accepts:

  ```
  inspection: { command: { argv, reach: 'local' | 'global', format: 'tagma' | 'sarif', timeout? }, params? }
  ```

- The landing and merge judgement, `inspect_work`, `try_inspection`, `enforce_rule` and the re-measure driver run the program and judge its violations exactly as they judge a builtin's ([[f2755a5b]], [[64798cd8]]).
- `read_inspections` answers the program contract's version, so the agent that writes a program learns what to speak from the server.
- A SARIF-emitting tool plugs in with no adapter.

## 2. Problem, with evidence

- Builtins cover what Tagma foresaw; every project also has law nobody foresaw.
- Without this, that law stays in tests nothing runs — runlith's 20 `readPackageBoundary` calls — or in prose.

## 3. What holds now

- [[be584b76]] admits only `{ builtin, params }`.
- The execution host runs admitted commands with limits and custody.
- Service-owned work is launched only by a non-thread actor ([[0139540b]]).
- Command rules bound a command's time ([[c243dd9f]]).
- `enforcement/` stands below `terminals/` ([[15d47c9d]]).

## 4. Target model — the contract

The contract is the public API every inspection author and every SDK builds on. It is versioned by `contract`.

**Input, as JSON on stdin:**

```
{ contract: 1, rule, params, root, tree, base, paths, files, baseFiles }
```

- `rule`: the rule's block name.
- `params`: the rule's own parameters.
- `root`: the checkout path.
- `tree`: the tree being judged, as a git object id.
- `base`: its base commit, or null.
- `paths`: for `local`, the changed paths; for `global`, null.
- `files` and `baseFiles`: for `local`, `{ path, text }` of each changed path at `tree` and at `base`.

At landing the judged tree exists only as git objects, never as a working tree. A program reads any other file at `tree` or `base` through git (`git -C <root> cat-file`), never from the caller's checkout. The SDK does this for it.

A program that needs the files on disk — a test runner, a compiler — declares `needs: 'files'`. The input then carries `workdir`: a directory holding exactly `tree`. The engine materializes it, not each project's program:
- a detached worktree of `tree`, readied by the project's own worktree setup (copied ignored files and the setup command, [[06ae746e]]);
- kept per tree while the tree is being judged;
- its readying time counts against the budget of the run point.

At `at: 'work'` the verdict is only answered, never recorded, so there `workdir` is the caller's own checkout and nothing is materialized. `workdir` is optional, so `contract: 1` holds.

**Output on stdout:**

- **`tagma` format:** `{ tree: Violation[], base: Violation[] }`, where a violation is `{ fingerprint, path, line?, message, value? }`. The engine subtracts the base side by fingerprint, exactly as for a builtin.
- **`sarif` format:** SARIF 2.1.0. A fingerprint is `partialFingerprints` when present, otherwise the rule id with the message text. The engine runs a local SARIF program twice, over `tree` and over `base`, because SARIF has one side per run. A tool whose fingerprints carry the path reads a renamed file as new; `read_inspections` states this limitation.

**Exit status:**

- 0: the program ran, and its output is the verdict.
- Any other status, a timeout, or output that does not decode: `inspection-failed` at gate, `watched` at watch, carrying the program's stderr.

**Placement.** The command runs on the admitted command road, in the checkout root. `enforcement/` reaches the road through a port it declares and `terminals/` fills, the pattern of 8cc6e74d5a; it never imports `terminals/`.

**Authority.** A program never runs as the server's own work ([[0139540b]]); it runs as the caller whose act triggered it:
- at a landing, the landing session;
- at a merge, the merging caller;
- in `try_inspection` and `enforce_rule`, their caller.

The re-measure driver runs builtins only. A command inspection's debt is re-measured by the next `enforce_rule`, and its escapes by the next landing that reaches it.

Time is bounded by `timeout`, else by the landing or merge budget's remainder, else by the project's command rules.

## 5. Owners and boundaries

- `enforcement/` owns the contract, the run, the decoding and the port. It adds nothing to `TagmaStack`.
- `terminals/` owns the command road and fills the port.
- `protocol/` holds the input and output schemas.
- The SDKs are separate: out, see below.

## 6. Rejected alternatives

- **Loading project code into the server's process.** It binds inspections to JavaScript, lets one crash take the server down, and hands project code the server's authority.
- **A per-tool adapter.** SARIF is the format hundreds of analysers already emit.
- **Letting a program read the working tree.** It would judge lines that are not landing ([[27244c4c]]).
- **Running a program as the server's work.** A thread naming a program would then hand itself service authority on every session's landing.

## 7. Acceptance criteria

In a fixture repository:
- a `tagma`-format program's violations refuse a gated landing and land on a watched one, and a violation both sides carry is not new;
- a SARIF-emitting program is judged with no adapter, and its `partialFingerprints` key the debt;
- a program that exits non-zero, times out or prints garbage refuses `inspection-failed` at gate with its stderr, and lands at watch;
- a `global` program is refused at landing by `enforce_rule` and runs at merge;
- the same program answers the same verdict through `inspect_work`;
- the command runs under the landing session's identity, visible in `read_commands`.

## 8. Claims and tasks this touches

- The claims written at the close of [[be584b76]] are extended rather than duplicated.
- Nothing standing dies.

## 9. Order of building

After [[be584b76]] closes: the port and its `terminals/` adapter, then the input and output schemas, then the run and the decoding, then the SARIF reading.

## 10. Contract

- Additive: the `inspection` union gains `command`.
- `contract: 1` is stamped on every input. A later field is added under the same number only if it is optional; anything else raises the number, and Tagma keeps speaking every number a standing rule names.

## 11. Stored data

- Additive to the enforcement document. No migration, and no reading step for old documents.

## 12. Who may do what

- A command inspection runs project code with the authority of the caller that triggered it.
- Naming or changing a command is its own permission subject, so a thread's mode can require the operator's word for it. `enforce_rule`'s confirmation names the argv.
- The judgement never runs a command no enforced rule names.

## 13. Long-lived things

- None: one process per run, ended by the host at exit or at the deadline.

## 14. Bounded resources

- Time per run, as in §4.
- Output: read up to the host's output bound; past it, `inspection-failed`.
- `global` programs never run inside a landing.

## 15. Rollout

- Additive. Nothing runs until a rule names a command.

## 16. Failures

- A host that offers no command road answers `inspection-failed`, naming the host state.
- A restart mid-run commits nothing, because the judgement precedes the commit.

## 17. Observability

- The run is a command visible through `read_commands` like any other.
- The spans `submit_work.gate` and `merge_worktree.gate` name each program with its duration.

out:
- The SDKs: each is a library over this contract, built when the first pack or project inspection needs it, and none changes the contract.
- Packs: they bundle rules and programs through the catalog installer, and are their own decision.
