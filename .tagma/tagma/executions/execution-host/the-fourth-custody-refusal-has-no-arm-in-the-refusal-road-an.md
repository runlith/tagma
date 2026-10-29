---
id: 01a0c973-312c-77ac-8124-e9ad26641770
title: The fourth custody refusal has no arm in the refusal road, and the prose above the owner still describes three
ord: 62
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c717-a237-76e9-957d-dec2ab09a4ae
---
Found reviewing [[71866771]]/[[ab09a4ae]]'s fix (`8bd19e79b8`) in `packages/execution-host/src/ExecutionCustody.ts`.

`InjectCustodyRefused` is the fourth custody refusal, and `host.ts`'s `refusalOf` carries no arm for it — the prose above it still says "THE THREE CUSTODY REFUSALS". A move failure reaching that door would fall through to `HostConflict` carrying the bare tag, so whoever met it reads `InjectCustodyRefused` and no sentence.

Unreachable today: `ExecutionRegistry.custody` converts every move failure into a `Refused` outcome before the refusal road, and the registry is the wire's only caller. The gap is latent, not absent — the conversion is what holds, and nothing asserts it.

Fix at the owner: `refusalOf` names the fourth refusal, or its caller's conversion is stated as the reason none is named there. Also restore accuracy to the prose the change left stale, which the reviewer measured:
- `ExecutionCustody.ts:152-153` — "it holds nothing to take, transfer or release, so `accept` below never sees one": `accept` now sees it and refuses.
- `:200-202` — "a scope that holds the execution may always take control back": false for the holder's inject scope.
- `:251-252` — "A release ends the control that STANDS, named by the scope ending it": the act names nothing (`control.ts:12-14`) and the scope must BE the standing controller.
- `:12` — "compares that principal against the holder or the standing controller": binding id and kind decide too.
- `host.ts:650-655` — "THE THREE CUSTODY REFUSALS".