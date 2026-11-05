---
id: 01a17d50-0f99-710f-9b57-821c005a3299
title: Consent to a new host ends the standing host only when it didn't accept the successor, and only by the program restoring its bundle at the successor
ord: 9
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17d2b-ffc2-717d-8c2a-e2e056ff6fb0
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/departure.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/firstEnable.ts
---
- **Consent is conditional.** `replace` is permission to end the standing host, not an order: the predecessor still asks its host to prepare the candidate, and an accepting host is handed over losslessly. A refusal under consent is only written to the log: the predecessor leaves with no handover and doesn't drop the candidate, because the new host rises from it. Without consent the same refusal drops the candidate and cancels the restart.
- **The successor ends it.** It sees the refusal as fact — foreign-build logic rejected the candidate at handover on signal or stayed silent (`Refused`, `Kept`) — and only then ends the host with the program restoring its own bundle: it speaks the standing build's wire, so the road is one both for a restart from this server and for a server that already rose next to a foreign host and doesn't speak to it. The program shutdown ends executions and takes the holder away; a holder that didn't release state gets SIGTERM, then SIGKILL, as on first enable. Then the raise puts the candidate in place and launches its own logic.
- **Threads find out.** Whoever held terminals is read before the host ends; each gets a `host-replaced` notification, as on first enable. Previous-generation records stay readable, and the pass over replaced generations drops their custody.
- **The bound.** New logic doesn't open an `executions.sqlite` carrying migrations outside its chain, so the store reaches an older logic returned onto that logic's chain: a logic of this build returns it as it yields to the candidate, and a step back returns an idle host's store with the other stores. A host ended without yielding — consent after a refusal — leaves its store as it stood, and an older candidate's logic then refuses it.
