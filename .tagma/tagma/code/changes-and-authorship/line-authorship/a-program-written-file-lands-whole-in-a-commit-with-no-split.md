---
id: 01a14c7f-137b-7a18-aec3-964d747fe3fb
title: A program-written file lands whole in a commit, with no split by line authors and no lines-held refusal
ord: 50
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c7f-3964-7960-a6e9-2a955c1843e9",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bf04-7004-acd7-a2029543a701
  - kind: relates
    to: 01a14c5f-311c-7fa9-b864-cf10de82b2fc
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/selection.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/submit.ts
---
A program-written file lands whole in a commit, with no split by line authors and no lines-held refusal.

A lockfile, generated code and other files a program writes — not a person or an agent — cannot be split by author: a slice of `bun.lock` by sessions matches no state of the manifests. Today `submit_work` and `check_law` over a change refuse `lines-held` when neighbours' lines stand in such a file; agents read `whole` as seizing someone else's work, and one `bun.lock` line held [[407453a6|the packages task]] open and reached the operator.

Needed: a session change touching such a file carries it whole in its current form; neighbours' lines leave with it and are named in `carried`; there is no `lines-held` refusal on it. For hand- or file-tool-written files the split by author and the refusal stay.

Which file counts as program-written is decided by three markers, with no separate setting:
- known lockfile names of ecosystems: `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `deno.lock`, `Cargo.lock`, `go.sum`, `poetry.lock`, `uv.lock`, `Pipfile.lock`, `pdm.lock`, `Gemfile.lock`, `composer.lock`, `mix.lock`, `pubspec.lock`, `Package.resolved`, `Podfile.lock`, `packages.lock.json`, `gradle.lockfile`, `flake.lock` — by file name in any directory;
- the git `linguist-generated` attribute (`true` includes, `false` excludes even a known lockfile) — that is the user's handle;
- a file the change record shows a command rewrote whole while no file tool ever edited it.

An unrecognized file behaves as before. The marker belongs to change accounting (the landing selection), not to a separate layer above the refusal; the Holdings judge, authorship of ordinary paths and `whole` do not change. The `submit_work` description names the behaviour in one sentence.

Proof: a public red→green through `submit_work` — two sessions write into a lockfile, one session's commit lands and names the other in `carried`; the same scenario on an ordinary file still refuses; `linguist-generated=false` returns the refusal. Narrow owner types and tests, one independent review, a commit.

Implemented in `6de91a03dd943752327c31b8e1479aee2f21ddb1`: program paths are selected whole before slicing; Holdings does not change. Nullable origin comes as a regular ADD COLUMN; old records are never guessed. The public red→green lockfile and attributes are proven (2 tests); a full command rewrite, origin preserved after commit, a partial edit with kept inner lines, a real-edit veto and a binary NUL file add 3 more tests. Both findings of the single independent [[01a14c88-beda-7977-8d90-2ffa63064146|reviewer]] are confirmed by a public red and fixed before green with no second review. `commandLanding.stest.ts` — 7 pass, `submitPeers.itest.ts` and `submitBytes.itest.ts` — 3 pass each; the files ran separately with `--parallel=1`. Narrow `bun check --threads=3`, the snapshot check and the diff are green.

Not proven is whether a separately taken commit is executable before this delivery's shared Effect form of checkoutFixture/commandWorld: the new tests are checked against the current shared tree and use that form, which HEAD did not have before landing. The operator's working server was never updated or restarted; the full suite never ran.
