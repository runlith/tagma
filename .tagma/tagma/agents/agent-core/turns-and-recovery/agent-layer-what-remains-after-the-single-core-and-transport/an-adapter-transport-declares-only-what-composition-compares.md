---
id: 01a151df-e920-73d7-9b09-09df1f36a049
title: An adapter Transport declares only what composition compares; flow capabilities are one snapshot in the row
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-6ae2-72a7-8565-b02edaf63602",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/transport.ts
  - kind: file
    ref: packages/agent/src/thread/transport/contract.ts
---
`Transport.capabilities` (`packages/agent/src/thread/transport/contract.ts:91`) at `terminal` and `acp` is the full `TransportCapabilities`, although only `Transports` reads it, comparing subjects by `history` and `compaction`. The values diverge from the flow snapshot written by birth (`external-harnesses/birth/seat.ts`): terminal declares `usage: 'partial'` for any profile, `acp` declares `usage: 'measured'`, `history` and `compaction: 'session'` for any profile, while `law`, `touch`, `authorship` at terminal stand `null` against a non-empty flow snapshot. Flow capability fact is derived in two places.

Do: the contract narrows to the declaration composition compares; flow capabilities stay the row's single snapshot.

Done (`049a50af21`): `Transport.capabilities` is replaced with a `declares: { history, compaction }` declaration — exactly what `Transports` compares against the presence of `TransportHistory`/`TransportCompaction`; acp declares both (it registers their subjects under any profile), terminal and native declare neither. Flow capabilities are derived only by the birth snapshot in the row. Check: `Transports.test.ts` — divergence in either direction refuses with `TransportMismatch` naming the adapter; agent package and server typechecks clean on touched files (agent still has others' `startRun` errors in collaboration/agents tests). Review with no findings.

Proof: a composition test — an adapter whose subjects diverge from the declaration fails the build with its name; typecheck clean.
