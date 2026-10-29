---
id: 01a12725-0bf7-7793-ac23-feab2d1f5572
title: "Operator's single-update rehearsal: his build leaves, the final build takes his data"
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12835-f1f4-7872-a7e6-75b2f180a6c9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79e65f9b619e
  - kind: waits-on
    to: 01a126b9-6a5d-780b-8049-422205931ea8
---
The operator updates once, and a failure leaves him with no server. Before he is asked, the same update runs on a clone of his data, without him and never touching his server.

Two parts:

- **Stores — required.** An APFS clone of `~/.tagma/tagma.sqlite` and the thread directory is opened by the final build: ledger translation, migration tail, key checks. Proven: opening passed, schema fingerprint and ledger what the build expects, thread reads readable from SQL and from file; opening time with a cold cache — a sample. No server built here.
- **Whole restart — only if provably harmless.** Predecessor — the build of the commit the operator's server stands on; data — a clone; own root and ports; successor — the final build. The first-run window measured. The execution-host holder line ([[d86d6647]]) never enters this rehearsal: delivered separately, and before it the host behaves as now. Launch condition: for every external effect of both builds' server launch the implementer names — run recovery and model calls, schedule, remote door and Tailscale, push, plugins, MCP servers, bridges, machine wake — and shows for each how it is switched off in the clone. What cannot be switched off provably is a reason not to run this part; then it is replaced by a "operator-build predecessor → successor" run on the synthetic set from [[9ae1db7b]] and the first part.

After the fix of shared WAL service on the copy, the earlier transition-tally background drain and reopen are checked: last receipts of running runs kept, thread history untouched, snapshot state blocks the drain until released. Checks fit the standing minute limit; a full drain of a big copy that never fits it stays explicitly unproven and never runs by a script past the limit.

The "Stores" part checked on 2026-10-11 on a fresh APFS clone of the operator data, HEAD `e3b3a612f21f`: Store.open with ledger translation, eight migrations and their FK checks — 3.670 s; reopen — 1.189 s, both one sample. Ledger matched the chain exactly, schemaDigest — `56a43d18d6edb6163c2db524e8cea3b7d79892194981ff8c4e22fc8708133818`. The snapshot blocked the public drain; after release one bounded TransitionRetirement.pass run in 10.935 s deleted 1,451 of 722,101 rows. All 11 last receipts of running runs kept after reopen; SHA-256 of nine SQL entries of three threads and six fully read rollout files (three plain, three zst) matched before and after migrations and the drain. The first run exceeded a minute from snapshotting the whole workspace_change; the owner's fix — `0ee1b7b68282`. Clones deleted. Cold OS cache and full drain of a big copy unproven. The second part ran on a copy of install `1766aa0990 20261010T132708440Z` with a new synthetic store, separate HOME and ports 52430–52433: the old CLI itself `update --head` launched the build of a clean cut `a1cbc5a45a`, then the old server handed the place to its successor. Client window to successful read_machine_state — 8.869 s, upper bound from the last successful trial — 8.898 s, one sample with a 25 ms trial period; the new execution host answered with the same cut's build. A `sqlite_source_id()` query through a placed SQL child returned `2026-03-13 10:38:09 737ae4a34738ffa0c3ff7f9bb18df914dd1cad163f28fd6b6e414344fe6`, equal to SOURCE_ID; the manifest held sqlite.native in CLI, server and execution host, plus a native PTY. The old updater runs tagma:build of the target HEAD, so the new release does the packing; no asset-carry defect found. Side effects isolated with empty runs/accounts/tokens, no operator plugins/MCP/bridges, zero push subscriptions and remote_origin; remote.enabled stays false, awake — while-working with zero runs. Signing used the standing identity, shell profiles written onl…
