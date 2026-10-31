---
id: 01a18044-3439-7c30-8a9c-311f1d80d11a
title: Slot-holder accounting is an ordinary field, only the display projection is reactive
ord: 72
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chat-ui/src/EntryKinds.svelte.ts
  - kind: file
    ref: packages/roster/src/Roster.ts
---
Slots register and remove effects, i.e. inside Svelte batch processing. In async mode, while another batch awaits `await`, the batch being processed reads `$state` with the waiting batch's writes rolled back — `untrack` does not cancel this. Checking a conflict against `$state` misses a removal written in the waiting batch. Then a part re-taking its place gets a `RegistryClash` with itself. And a read-modify-write from the rolled-back base resurrects removed slots.

So who holds a place is decided by an ordinary `ledger` field: it is a present-time fact, and so is the list a change is computed from. Only the published list goes into the reactive cell, and Svelte keeps batches consistent for it. For the same reason the revision counter in `EntryKinds` grows from an ordinary variable, not from a read `$state`: a rolled-back value would give a write equal to the current one, and readers would never update.

Tagma compiles without async mode, where no batch is held and nothing is rolled back; the ledger stays, since it holds in either mode.
