---
id: 01a0d83b-ec85-7994-9422-5bf17952b237
title: "Build: a rule's inspection can be a project program run on the execution host as the triggering caller, judged by the same debt and gate as a builtin"
ord: 146
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d833-9712-787a-ab41-5ce2f3a9c9d0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d4e4-fbe8-775c-8493-93f850467aad
---
Build [[50467aad]]: a rule's inspection may be a project program (`command: { argv, reach, format, timeout?, needs? }`), run on the execution host as the caller whose act triggered it, fed the contract-1 JSON on stdin, its `tagma` or SARIF output judged into the same debt and gate as a builtin's.

Order (§9): the port in `enforcement/` and its `terminals/` adapter; the input and output schemas in a new `protocol/` file importing only `effect`; the run, the decoding and the `needs: 'files'` materialization (detached worktree of the judged tree, readied by `worktrees.setupCopy` and the operator's `worktrees.setupRun`); the SARIF reading.

Done when §7 holds in a fixture repository — tagma-format violations refuse a gated landing and land a watched one, a violation on both sides is not new; SARIF judged with no adapter and keyed by `partialFingerprints`; non-zero exit, timeout and garbage refuse `inspection-failed` with stderr at gate and land at watch; a `global` program refused at landing by `enforce_rule` and run at merge; `inspect_work` answers the same verdict; the command runs under the landing session's identity, visible in `read_commands` — plus a contract test feeding the engine's real input to `scripts/testLayer.ts`, the cost of materializing a runlith tree measured, claims written under [[805446cf]], deltas filed.

Out (next task): `at: 'work'`, `inspect_work { layers }`, the re-measure driver running program rules, enforcing runlith's test layers.
