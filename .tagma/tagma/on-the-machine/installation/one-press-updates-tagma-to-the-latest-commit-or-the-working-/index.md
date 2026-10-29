---
id: 01a0cfa8-97dd-7ed3-9301-569c2aa71f01
title: One press updates Tagma to the latest commit or the working tree, with the server running the build-then-restart chain
ord: 42
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/frame/StandingChip.svelte
  - kind: file
    ref: apps/tagma/server/src/cli/commands/setup.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/health.ts
  - kind: file
    ref: apps/tagma/server/src/installation/builds/checkout.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/release.ts
  - kind: file
    ref: apps/tagma/server/src/protocol/machineStanding.ts
---
The operator accepted the published prototype as the target: `http://localhost:5634/a/5412ea3b7c38` (`curl` it; its layout, states, copy and chip words are the spec for the surface half). Everything below is what the prototype needs from the code.

## 1. Outcome
The standing popover answers "does Tagma run my latest code?" at a glance and brings it there in one press: **Latest commit** or **Working tree** builds and then restarts with no second act, and terminals survive. ⌥ (or the "build only" toggle beside the note) builds without restarting. `tagma update --head|--tree` does the same from a terminal.

## 2. Problem
- Updating takes three acts: Build, wait for it, Restart.
- The popover cannot say how far the checkout is from what runs; it prints `Build 7045ceeaf1-dirty` and nothing to compare it with.
- "Restart · same build" is false when an update waits: the successor is always the installation `current` names (`Succession.successor`), so it brings up the new build.
- Unlabelled glyphs (the refresh icon, "▾") and a static footer (`tagma status`) carry nothing; the acts' own `command` strings are never shown.

## 3. What holds now (read in the code)
- `POST /api/health/build {from}` starts one build in `CheckoutBuilds` and restarts nothing [[2fb7fe7b]]; the page follows it by polling standing and never restarts [[574d3dd8]].
- `CheckoutStanding` is `{path, head, dirty}`. `dirty` comes from `gitCut`, which reads status with `untracked: 'no'`; a tree build runs in place and carries untracked files anyway. The installation label (`release.ts` `labelled`) uses the same `gitCut`, so a tree build that differs from HEAD only by new files is labelled exactly as HEAD.
- `BuildRunning {from, revision, since, log}` and `BuildEnded {from, revision, outcome, build, detail, endedAt, log}` live in `CheckoutBuilds` memory and die with the process — so the restart an update ends with erases them.
- Every act carries its CLI `command`; nothing prints it.

## 4. Target
1. **The server carries the chain.** The build ask takes `then?: 'restart'`; absent keeps today's behaviour. A build that lands with it restarts exactly as `tagma restart` does (host when-idle); a failed one restarts nothing. A restart the succession refuses is written on the ended build (`restart: { refused: detail } | null` or equivalent) so page and CLI can say it. `BuildRunning` carries `then`. New acts `update-head` and `update-tree` (command `tagma update --head|--tree`, ends 0, disabled exactly when the matching build act is).
2. **CLI verb `tagma update --head|--tree`:** asks the build with `then: 'restart'`, follows it as `tagma build` does, then waits for the successor as `tagma restart` does, and prints where it ended. Against a server without the act it refuses by name, as `tagma build` does with `no-build-door`.
3. **Distance to the checkout** on `CheckoutStanding`: `subject` (HEAD's subject line), `ahead` (commits HEAD has that the running build's commit lacks; null where the running build names no commit this checkout resolves, e.g. an installed release), `changed` (tracked changes plus untracked files that are not ignored), `tree` (fingerprint of the working tree's difference from HEAD; null when clean). Compare commits through git, never by string prefix: `--short` lengths grow with the repository.
4. **Tree fingerprint in the installation.** A tree build records the same fingerprint in its manifest; the installation cut the server answers carries `tree: string | null`, optional on decode. "The working tree is running" = same commit and equal fingerprints. A manifest without one reads as unknown, and the Working tree row says "may differ" instead of "running".
5. **A label never names HEAD for a build carrying files HEAD lacks:** untracked, non-ignored files make the label `-dirty`. Only the label's reading changes; other callers of `gitCut` keep theirs.
6. **Build progress, and the record surviving the restart.** `BuildRunning` gains `step` (`worktree | install | build`) and `tail` (the last log line). `BuildEnded` gains `since` and `tail` (the last lines of the log, bounded). The last ended build is persisted beside the build log and read back at boot, so the successor still answers `built`, and the page prints "usually m:ss" from the last landed build of the same `from`.
7. **The popover** (`StandingChip.svelte`) is rebuilt to the prototype:
   - a header with the brand, the running build, a dirty tag and a state sentence;
   - **Update to** rows with a hover action and a "running" badge;
   - a progress panel with segments proportional to the steps, a timer, "usually", and the live log line;
   - a ready card with "Restart to apply" (the Server row's Restart is hidden while it stands);
   - a failed card with the tail, "Open log" and "Try again";
   - a Server row with Restart and a ⋯ menu holding Restart everything with its price;
   - a Host row with its build, uptime and a terminals disclosure listing what it holds, a ⋯ menu (Replace now, or Update now / Update when idle while the host waits) and a waits line with "Update now";
   - the inline confirmation, whose law is unchanged [[13ccb2a8]];
   - a footer that echoes the hovered act's `command` and holds read-at with refresh.

   The page also reads the standing when the popover opens.
8. **The chip:** the hash, plus `↑N` while the checkout is ahead and `±N` while only uncommitted changes differ; `updating · m:ss`, `building · m:ss` or `restarting` during acts; everything else as today [[68c8e46e]].
9. **The command palette** gains "Update Tagma to latest commit" and "Update Tagma to working tree", present only where the server names a checkout.

## 5. Owners and boundaries
- Server:
  - `http/checkoutBuilds.ts` owns the chain, the step, the tail and the persisted record; it is handed the restart to call and does not learn how a succession works.
  - `http/handlers/health.ts` owns the acts and the checkout distance.
  - `protocol/machineStanding.ts` and `protocol/source.ts` own the contract.
  - `install/release.ts` owns the label and the fingerprint written into the manifest.
  - `cli/commands/setup.ts` owns `update`.
- Surface:
  - `Standing.svelte.ts` owns every act and its following: an `update(from)` beside `build` and `restart`, following the build and then the successor up to the reload.
  - `StandingChip.svelte` renders only.
  - The palette entries call `Standing`.

## 6. Rejected
Chaining in the page. A tab closed or reloaded during a two-minute build would drop the restart, and the CLI would not have the verb.

## 7. Acceptance
- With the checkout ahead, one press on Latest commit builds; the server restarts on its own; the page reloads onto the new build; the host's terminals are still running.
- A press with ⌥ builds only; the ready card's "Restart to apply" brings the build up.
- A failed build shows its tail and restarts nothing; "Try again" reruns the same `from`.
- Closing the tab mid-update does not stop the server from restarting onto the build.
- `tagma update --head` does the same from a terminal and prints where it ended.
- The state sentence and the chip suffix are right in each of these cases:
  - behind by commits;
  - the same commit with other uncommitted changes;
  - the running tree equals the current tree;
  - an installed release (no update rows at all).
- After an update, the successor answers the build that brought it up in `built`.
- Decoding does not fail in either direction between this build and the one before it (every new field is optional on decode).
- Typecheck and the touched suites pass; new tests follow `ag-no-shit-tests`.

## 8. Standing claims and tasks
These are rewritten from the code once it is built:
- [[574d3dd8]]: the page now asks for a restart through the chain;
- [[2fb7fe7b]]: a build asked with `then: 'restart'` restarts;
- [[c80c9e1d]]: the build items become the update rows;
- [[68c8e46e]]: the chip's words.

These are re-read and re-verified: [[bacce79f]] (the standing is also read on open), [[b4c3ccd9]], [[c708a573]], [[13ccb2a8]], [[66ff12e8]], [[6f5e7ea9]], [[79b785b9]].

New claims are written for the chain, the persisted record, the fingerprint and the distance.

## 9. Order of building
1. The contract and the server — the fields, the chain, the persisted record, the fingerprint and the label — with their tests.
2. The CLI verb.
3. `Standing.svelte.ts`.
4. `StandingChip.svelte`.
5. The palette.
6. The claims.

## 10. Contract
Every addition is optional on decode, and `then` absent is today's build, so no version moves. The page and the server ship in one installation. Only the CLI can meet an older server, and it refuses by name there.

## 11. Stored data
- A new file beside the build log holds the last ended build; one that is absent or unreadable reads as none.
- A record found at boot for a build that never ended reads as an interrupted failure.
- The manifest gains an optional `tree`; older manifests read as unknown.
- Rollback: an older server ignores both.

## 12. Who may do what
out: the health group already answers only the machine's operator, and `update` adds no actor.

## 13. Long-lived things
The chain lives in the build's promise inside the server. A server ended mid-build — a crash or a forced restart from elsewhere — drops the build and its chain as today, and the persisted record says so at the next boot (§11).

## 14. Bounded resources
- The tail is bounded, at about 20 lines or 4 KB.
- The fingerprint is computed on every standing read, and the page reads every two seconds during a build. Measure it on runlith with a realistically dirty tree; if one read exceeds about 200 ms, cache it by what invalidates it (index and file mtimes), and state the figure in the claim.

## 15. Rollout
The first update onto this build runs through a server that lacks `then`; it is done once by hand (Build, then Restart). After that, page and server are always the same build.

## 16. Failures
- A failed build: no restart.
- A refused restart (no successor, or the successor left): the server keeps serving, the ended build says why, and the page shows it.
- A dropped connection during the build: the page keeps following. During the restart: the page waits for the successor as today.
- Concurrent acts: one at a time on the page [[6f5e7ea9]]; a second build is refused by name [[2fb7fe7b]].

## 17. Observability
- The build log frames the chain: a line saying a restart follows, and the restart's outcome.
- The serve log frames the successor as today.
- `tagma status` prints the ended build with its restart outcome.
