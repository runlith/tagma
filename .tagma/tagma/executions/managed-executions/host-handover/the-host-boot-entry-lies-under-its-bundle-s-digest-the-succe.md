---
id: 01a12a12-553a-71f7-96a2-7554bc6d8e44
title: The host boot entry lies under its bundle's digest; the successor places the candidate before STANDING_BY
ord: 1
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/executions/host/offer.ts
    symbol: placeCandidate
  - kind: symbol
    ref: packages/executions/src/protocol/boot.ts
    symbol: bootPath
---
- **Why by digest.** The holder launches each logic by its argv, and the next one's argv is pinned by PREPARE while the old one still lives. One shared `boot.json` would be read by a foreign build: old logic crashed before handover reads as the new one's entry; the old one after a failed holder exec (rollback to `bundle.prior`) reads as the new one's entry too. Nobody reads the `bootPath(state, D')` file before activation; rollback returns argv to the untouched file D.
- **Entry-only change** (same digest) places `boot.next.json`; the departing predecessor carries it onto the standing digest's file before Yield. The same build reads it, so early reading after a logic crash is harmless.
- **Stage 1 before `STANDING_BY`.** The bundle is copied into the successor's own directory, verified, and becomes `bundle.next` in one rename; the entry file is written first so the visible candidate already has an entry. A refusal is typed; the successor exits before `STANDING_BY`, the predecessor keeps working.
- **Who removes the candidate.** The successor — on its own exit, until it takes the data directory; the predecessor — on a preparation refusal. The next placement sweeps stale `boot*.json`, keeping the standing and being-placed digests' files.
