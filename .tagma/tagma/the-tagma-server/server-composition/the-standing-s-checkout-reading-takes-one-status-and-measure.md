---
id: 01a0daf8-909f-79f1-8212-d56e98456d95
title: The standing's checkout reading takes one status and measures the tree fingerprint only for a running build cut from edits; the host and the checkout are read at once
ord: 30
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/composition/http/health.ts
    symbol: healthHandler
  - kind: symbol
    ref: apps/tagma/server/src/graph/projects/git.ts
    symbol: gitTree
  - kind: symbol
    ref: apps/tagma/server/src/installation/builds/checkout.ts
    symbol: CheckoutBuilds
---
## 1 Outcome
`GET /api/health/standing` answers in the time of one `git status` of the checkout plus its host reading, instead of about eleven git processes and a whole-tree binary diff read one after the host. The standing says the same things: head, subject, dirty, changed, how far HEAD moved past the running build, and which state of the checkout the running build is.

## 2 Problem and evidence
`serve.log`: the instance that ran 21:33–23:18Z answered 160 standing reads averaging 2.9 s, the slowest 26.5 s; the instance booted 23:18:23Z answered 44 in 16 minutes averaging 0.68 s, the slowest 1.6 s. The page reads the standing on mount, focus, a return to the tab, a live reopen and the popover, so each wait is felt.

A slow read taken apart (`read_performance` breakdown of span 218eefaad0924bc1, 1,294 ms): `Git.tree` 1,179 ms, `Git.cut` 290 ms, `CheckoutBuilds.distance` 159 ms, `Git.text` 137 ms, the host's wire requests after. `GIT_TRACE` over one `CheckoutBuilds.checkout` of this checkout (71 changed files, running build clean at 9799622ccb): 11 git processes — `status` twice (untracked all and no), `rev-parse --git-dir` twice, `diff HEAD --binary` of the whole tree, `rev-parse --show-toplevel`, `rev-parse --short HEAD`, `log -1 --format=%s`, two `rev-parse …^{commit}` and a `rev-list --count`. In a rig outside the server the reading took 1.4–2.8 s cold, 0.4 s warm.

## 3 What holds now
- The fingerprint (diff against HEAD plus untracked stats, claim 53a1d23e) decides only one thing: whether a running build cut from a dirty tree is this tree (`runsOf`, claim 5ee11a40). The running build here was cut from HEAD, so every read hashed the whole diff and threw it away. No surface reads `checkout.tree`.
- `gitCut` and `gitTree` each run their own `status`; `status --porcelain=v2 --branch` already names the full HEAD oid.
- The handler reads the host standing and then the checkout, one after the other, though neither needs the other.

## 4 Target model
- One `statusAt(untracked: all)` answers the head oid, dirty (staged, unstaged, unmerged — any change, untracked included, as the standing counts today) and changed.
- One `git log -1 --format=%h%x00%s` answers the short head and subject.
- The distance resolves only the running build's own commit against the head oid the status named; `rev-list --count` only when they differ.
- The fingerprint is measured only when the running build carries edits and the tree has changes; otherwise `tree` is null, and `runs` is decided exactly as today.
- The handler reads the host standing and the checkout concurrently.

## 5 Owners and boundaries
`apps/tagma/server/src/http/checkoutBuilds.ts` (`CheckoutBuilds.checkout`, `distanceOf`), `apps/tagma/server/src/graph/projects/git.ts` (the fingerprint split out of `gitTree` so the release keeps `gitTree` whole), `apps/tagma/server/src/http/handlers/health.ts` (concurrency). The host's own listing cost stays with its owner (agent `inventory-storm`).

## 6 Rejected
- Keeping the standing warm behind the tree watch: a cache at the consumer of git, and the operator forbade it; the reading was paying for work nobody used.
- Reading the checkout row `CheckoutStatus` keeps: that row is held only while a surface follows the root, and counts per area; the standing would take on its lifecycle for one number.

## 7 Acceptance
- `checkoutBuilds.itest.ts`: a clean running build reads `runs` `tree`/`head`/`other-commit` as before with `tree` null; a running build cut from edits reads `tree` when the fingerprint matches, `other-edits` when it does not, and the fingerprint holds while the tree does and moves when it moves.
- The same rig as §2 (`GIT_TRACE`, this checkout, running build clean): at most 5 git processes per reading (4 where HEAD is the running commit) and no `diff`; the reading's time falls accordingly.
- Deployed: the route's average in `serve.log` under the same conditions.

## 8 Claims and tasks
- 5ee11a40 stays true; its body gains when the fingerprint is measured.
- 53a1d23e moves its symbol source to the split-out fingerprint function; its text stays.
- A new claim: one status, the fingerprint only for a running build that carries edits, the host and the checkout read concurrently.

## 9 Order
The fingerprint split in `git.ts`, then `CheckoutBuilds.checkout`, then the handler; the itest updated with the code.

## 10–17
- 10 Contract: `CheckoutStanding.tree` stays an optional string; it is null where the running build carries no edits. No reader consumed it.
- 11 Stored data: out — the build record is untouched.
- 12 Who may do what: out.
- 13 Long-lived things: out — no state is kept.
- 14 Bounded resources: git processes per standing read, from 11 to at most 5 (7 with a running build cut from edits).
- 15 Rollout: needs a deployment of the server; nothing running changes meaning.
- 16 Failures: a status git refuses reads as it does today — head null when HEAD cannot be read, changed 0 when the status cannot; the fingerprint failing leaves `unmeasured-edits`.
- 17 Observability: `http.server GET` spans with `http.route` `/api/health/standing`, and `serve.log` timings.

## Divergences found while building
- §16 as built: the head, its short name, the subject and so the distance all come from one log line, independent of the status. Where the status cannot be read but HEAD can, `head`, `subject`, `ahead` and `runs` still answer and `changed` reads 0; before, `head` went null with the status. Where HEAD cannot be read, all of them read null as before.
- §7 time: in the rig (this checkout, running build clean, load average ≈ 38) the git processes per reading fell from 11 to 5 and the diff is gone, yet the reading still took 2.2–3.0 s against 1.4–2.8 s before: `git status --untracked-files=all` alone took 1.1–2.5 s there (0.19 s with `-uno`), the walk for untracked files. The standing's latency is now that walk plus the host reading, read concurrently.
