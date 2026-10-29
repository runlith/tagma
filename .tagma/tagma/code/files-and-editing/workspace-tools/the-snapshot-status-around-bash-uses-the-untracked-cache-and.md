---
id: 01a102e4-277f-7c7c-a308-0367911210a1
title: The snapshot status around bash uses the untracked cache and fsmonitor that checkout.fastStatus turns on
ord: 35
tags: ["task"]
fields:
  {
    "holder": "tagma:01a102e4-5120-7965-a13e-7d91a87e755a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a10284-da13-7e0c-9742-a432e334c004
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/fastStatus.ts
  - kind: file
    ref: packages/agent-tools/src/CheckoutBaselines.ts
---
**What.** The checkout snapshot's `git status` around bash should cost the same as an ordinary `git status` on this repository, not walk all of untracked.

**Why (measured 2026-10-03 on runlith, git 2.50.1 Apple, `checkout.fastStatus` on, `core.fsmonitor=true`, `core.untrackedCache=true`, daemon watching the repository).** `CheckoutBaselines` (`packages/agent-tools/src/CheckoutBaselines.ts:279-280`) calls `git --no-optional-locks status --porcelain -z -uall` before and after every command.
- `GIT_TRACE2_PERF` of that call: `refresh` (fsmonitor) — 25 ms, `read_directory` (untracked walk) — 307 ms. Fsmonitor works, but the untracked cache is not used.
- That same call takes 230–290 ms with speedups, 250–340 ms with `-c core.fsmonitor=false -c core.untrackedCache=false` — the speedups buy almost nothing. The same status without `-uall`: 70 ms.
- Likely causes, to be confirmed: the untracked cache serves `-uall` only when built in that mode (`status.showUntrackedFiles=all`), and `--no-optional-locks` keeps git from saving the refreshed cache and the fsmonitor token into the index.

Total now: about 0.5–0.7 s on every bash command for two statuses alone. Grows with the repository's file and directory counts.

**Direction.** The decision belongs to the snapshot owner (`CheckoutBaselines`) and the settings owner (`workspace/checkouts/fastStatus.ts`), by measurement:
- either the snapshot reads status in the mode the cache serves and expands only the listed untracked directories itself;
- or `fastStatus` builds the cache in `all` mode and someone owning it keeps it saved without taking `index.lock` on the agent command's path.
Keep the reason for `--no-optional-locks` (not disturbing other git commands with the index lock). The snapshot's behaviour — the same path set, including every untracked file — does not change.

**Done when.** On runlith with `checkout.fastStatus` on, the snapshot status costs about as much as an ordinary status (tens of ms), trace2 shows the untracked cache working; the snapshot's path set matches the old one (contract test); with `fastStatus` off the behaviour is as before.
