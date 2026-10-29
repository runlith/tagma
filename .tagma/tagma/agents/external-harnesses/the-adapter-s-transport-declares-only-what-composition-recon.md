---
id: 01a14e26-7cd7-7a42-94b0-3c4d40db5fe8
title: The adapter's Transport declares only what composition reconciles, not a second snapshot of thread capabilities
ord: 78
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a14cf8-6242-70e6-a782-5ed82cc78913
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/transport.ts
  - kind: file
    ref: packages/agent/src/thread/transport/contract.ts
---
`Transport.capabilities` on `terminal` and `acp` is a full `TransportCapabilities`, though only `Transports` reads it (reconciling subjects against `history` and `compaction`). Its values diverge from the thread snapshot in `birth/seat.ts`: the terminal declares `usage: 'partial'` for any profile, `acp` declares `measured`/`session` even for Devin; `law`, `touch`, and `authorship` stand `null` next to a non-empty thread snapshot. Narrow the contract to what composition reconciles, so the thread capability snapshot has one owner. Proof: typecheck and a composition test for subject mismatch.
