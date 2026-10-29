---
id: 01a159e7-85d5-71ad-9cb6-d4bcb495071b
title: "A rule violation shows everywhere in one shape: norm, place and how to fix"
ord: 59
tags: ["task"]
fields:
  {
    "holder": "tagma:01a159e7-a423-7ea2-83f8-a95b657bc646",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15999-729b-7cc3-be53-cd4a6258036f
---
A rule violation must read the same everywhere it shows, and explain what to fix. Right now the `submit_work` answer for a commit into law-lab (`4d70624318`) looks like this:

```
watched (1):
  18ad9402 packages/domain/src/summary.ts -> @law-lab/ui  packages/domain/src/summary.ts:1  @law-lab/ui → @law-lab/ui
```

- the rule is named only by number;
- the place repeats three times: in the fingerprint, in the file with line, and in a chain of one link;
- there is no hint how to fix it. The check has one: the shared escape in the `Loading.forbid` description, the `instead` field of each `environment` ban. But it never reaches the answer.

**What to do.** The owner is enforcement. The finding view is built once and drawn the same:
- in `submit_work` (`watched`, `carriedViolations`), in the gate refusal, in `merge_worktree` and `commit_checkout`;
- in `check_rules` and in `read_enforcement` escapes and refusals;
- on the Rules screen;
- in hook output on a plain `git commit`.

A view of three parts:
1. norm: the rule title and strictness;
2. place and point in one check phrase (`summary.ts:1 loads @law-lab/ui`), chain — only when it has more than one link;
3. `fix` — how to fix this violation.

The check gives `fix`: every inspection-contract finding carries a hint field. Builtins fill it from their data — `environment` from `instead`, `Loading.forbid` from `allows`, and so on, go through all builtins. Custom inspections (`defineInspection`/programs, `Linters.command`) pass the linter message. With no hint, the shared escape from the function description is used.

The public contract is in `@runlith/tagma/rules`. Update the `rules` skill in the same change (rule de8d5a75).

**Proof:** a gate refusal and watch answer in law-lab with rule 18ad9402 show norm, place and fix; the `git commit` hook prints the same; a contract test on the finding for every builtin check that fills fix.
