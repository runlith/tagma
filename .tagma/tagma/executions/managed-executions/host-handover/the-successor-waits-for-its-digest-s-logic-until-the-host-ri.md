---
id: 01a12a1e-7410-7b22-8c1b-47b2ce39be5f
title: The successor waits for its digest's logic until the host rises, while the holder holds state, and ends the wait only on fact
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/arrival.ts
---
- **Before raise.** In the handover gap the old logic already dropped `host.sock` while the new one doesn't listen yet: presence reads as Absent, and raising without waiting would launch a second holder onto the same table.
- **What it waits for.** Registration names the candidate's digest, and status answers with admission `open`: this tells the new logic apart both from the departing one (its admission is already fenced) and across a change of a single boot entry where the digest doesn't change. The new logic writes its witness into registration before opening the endpoint.
- **Foreign-build logic in registration.** The successor asks it once per witness to yield by signal (`LogicYield`, road [[0123fde2]]). Logic departing after Yield skips the signal and exits; logic left after a failed handover or raised by holder rollback checks the candidate and yields or writes a refusal. A dead witness (`Gone`) means the holder raises the next logic, and the wait continues.
- **The verdict is fact only.** `Arrived`; `Unheld` — the writer claim is free: there is no holder, the pre-raise reshuffle puts the candidate in place; `Refused` — the refusal the asked logic writes to `yieldRefusalPath`; `Kept` — registration of the wrong schema or directory, the foreign-build logic has no witness, the signal can't be delivered, or own-digest logic answers with something the server can't read. A failure of one's own read — of registration, `lsof`, of clearing an old refusal — is no fact about the logic: it is asked again. While the holder holds the claim and the logic is alive or rising, the wait lasts as long as it takes: on a slow machine boot takes minutes. Status to own-digest logic goes with no deadline; an answer or a broken connection ends it. The claim is read through the `ClaimHolders` port of the platform adapter (on macOS by `lsof`), so no more than once a second; frequency only decides when to ask again.
- **With no fact.** Own-digest logic, alive and hung after Welcome, holds the raise forever: nothing publishes such a hang. So does logic that crashes before ready while the holder with executions raises it again, and a bundle the holder rejected but takes again on PREPARE permission after every yield request: the holder knows these facts but publishes none of them. A refusal recorded for a previous candidate or written by a torn channel is indistinguishable, by the refusal file, from an answer to this request.
