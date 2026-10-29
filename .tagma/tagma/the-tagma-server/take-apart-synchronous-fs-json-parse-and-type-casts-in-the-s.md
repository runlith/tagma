---
id: 01a15120-d727-72aa-b665-acc0f13fcc59
title: "Take apart synchronous fs, JSON.parse and type casts in the server and packages: tasks only on real defects"
ord: 138
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15121-44ce-78d1-a670-de479e993e33",
    "status": "done"
  }
---
Counts across the server and packages showed places where event-loop blocking and unchecked data are possible, but not broken down by place. What is needed is classification, not a mass fix.

- **Synchronous fs** — 194 calls in `apps/tagma/server/src`; most in `artifacts/shelf.ts`, `release-channel/runner.ts`, `mac-applications/placement.ts`, `graph/storage/relocation.ts`, `enforcement/commits/{hooks,queue,mergeDriver}.ts`, `enforcement/cli/merge.ts`, `installation/closure/versions.ts`, `installation/process/trial.ts`, `graph/tree/layout.ts`. Split: request or live-server background path versus CLI, install and separate processes where synchronous calls are acceptable. `graph/tree/projection.ts` is out here; it has its own task.
- **`JSON.parse`** — 89 in the server, 99 in packages: find parsing of data from disk, the wire or a process with no schema check after it.
- **Casts** — `as unknown as` (server 26, packages 70, app 24) and non-null `!.` (server 153, packages 142): find the ones that substitute for checking data from outside the process.

The outcome is tasks only on real defects, each under the owning place, with a discovered-from link to this triage; the rest is named in finish as one "acceptable because…" list. No code changes in this task.

## Triage outcome

14 tasks were created under the read owners, each with discovered-from on this triage, with path, lines, violated contract and a way to prove the fix: 8 on growing synchronous file passes in the live server and 6 on missed JSON checks. Among the sought `as unknown as` and `!.`, no separate boundary-decode substitution was found. No code was changed; graph/tree/projection.ts is excluded entirely.

The source counts are a historical measurement. The current lexical fs inventory: 576 node:fs *Sync callsites in 108 files of server/src excluding testing/tests/bench, *.{test,itest,stest,spec,bench}.ts and projection.ts; it includes CLI, workers and startup code, so it is not a defect count. JSON.parse: 83 in the server production sample and 99 in packages after the main test/fixture/corpus exclusions; packages also holds standalone capture/build and a few public test helpers.

Checking meant reading producer→caller→consumer, narrow read-only probes of public readers on synthetic inputs, and one independent review of the whole outcome. Such bytes are never passed off as observed answers of real vendors. For fs, locus and volume growth are proven, but real duration and response impact were not measured; they stay the proof of the corresponding task performers. Shared tests/typecheck were not run: the code did not change.

## Acceptable because…

- graph/storage/relocation.ts and transferWorld run in a separate transfer CLI; release recursive copy/prune and mac-applications/placement.ts clearPlace/forgetBundles run in a child install-from. They do not hold the serving server's loop. At the same time, the server callers metadata and closure/versions are not declared CLI-only: the shelf's bulk passes are triaged separately.
- The full graph/tree/layout.ts scan/validation, titles, checkout-files, change-record lines/hunks and enforcement cache run on worker paths. This does not excuse incremental mirror repair: a separate task exists for it. No production caller was found for writeBlockTree and sweep/stripComments; no server run is attributed to them.
- Cut/build/release tooling, trial backup/rollback and boot-only inspection cleanup run before the door or in a separate install process. Their startup/shutdown duration is not proven to delay already served requests.
- One HTML page, one network chunk, a bounded outputStore window/tail of the log, a single stat/realpath/exists, short markers/scripts and small startup/lock records are bounded work. Several hook/config files, small persisted memories and the projects/settings registry export got no task for one Sync without proven substantial harm. The shared commit queue's separate task covers compaction of the whole journal, not a single fsync: the backlog limit is set per project, not over the sum of all projects, and unreadable rows are preserved.
- JSON.parse is a syntactic step before decode at Batch, plugins, retained evidence, graph stored fields, checkers/queue/cache, CredentialFile, workflows, cookie-file reader, speech/audio/input wire, executions and OAuth readers. In settings, values pass schema resolution; typed data is never admitted by a single cast.
- Manual checks of input claims, refusal, worktree deletion/PR, hook install, vendor metadata/tail, ndjson-rpc envelope, paging tuple/key/selection, Layer visitor scheme and window placement close exactly the consumed shape. No mass replacement with Schema is required by this triage without a separate violation of behavior. Ripgrep, token count, workspace manifest and capture metadata are taken into tasks only where the already provided check misses null/wrong type and yields a TypeError.
- Arbitrary JSON/unknown is itself the contract of retained tool output, view storage, activity body, capture relay/hooks and intermediate parsers; operation/tool arguments are then decoded by their owner. A round-trip of a just-serialized value, a SQLite JSON aggregate, a generated schema and compiler source maps are no substitution of an external domain record.
- `as unknown as` erases generics of keys/Layer/transactions, AST shape, SQL expression and ABI; `!.` follows from regex, length, Map membership or a local lifecycle invariant. String/regex matches with `!.` are no assertion at all. No separate real boundary miss in exactly these shapes was established.
- CDP result/params rest on the managed-Chromium protocol; no separate task was created just to check each typed shape: a synthetic malformed frame was shown, but no contract admitting such input was violated. The capture package's own package.json is likewise not declared an external document; the Codex task stays only on the model catalog, for which HomeUnprepared is provided.
- Standalone capture/extraction/build probes may refuse or throw on a corrupted corpus. They are not mixed with the server request path; the typecheck, capture Devin and capture Codex tasks are named as separate CLI/developer defects. The platformsDeclared step is separately marked temporary and applying only to the not-yet-reduced platforms check: before moving the computation into the store, the step's mandatory folding into the store must be checked.
