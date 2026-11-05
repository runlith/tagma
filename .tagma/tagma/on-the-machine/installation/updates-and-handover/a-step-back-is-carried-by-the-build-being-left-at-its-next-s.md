---
id: 01a1ad3a-f8a3-7ca8-ac2e-6d6fdef31b76
title: "A step back is carried by the build being left, at its next start: it returns every store onto the previous release's chain before that release becomes current"
ord: 11
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a13d03-7a6a-76e4-9fa2-6c3b9e8adf53
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee476cec84de
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/returning.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/returning.ts
  - kind: file
    ref: apps/tagma/server/src/installation/closure/moves.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/stepBack.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/succession.ts
---
Only the build that applied a migration knows it: the previous release is frozen with people and refuses at open any store whose ledger names a migration outside its own chain. So the leaving build reshapes the data, and the release it returns to never has to understand what came after it.

- **At the next start, not at shutdown.** Asking a step back records `install/back.json` `{from, to, carried: false}` and moves nothing. The restart that applies it starts the leaving build again, and its CLI phase carries the step back before the server bundle loads: a leaving server's exit has a one-minute deadline that a large store's reshape does not fit, and a server bundle that cannot start still steps back. Asked with no server running, the next start carries it.
- **Order.** Under the data directory lock each store that does not fit the target chain is copied aside as `<store>.back` — a copy that cannot be made fails the step back before anything changes — then every store is returned onto the target chain. Only then, under the install lock and only while the asked record, `current` and the target still stand as asked, the attempt `{from: leaving, to}` and `returned.json` are written, `back.json` becomes `carried` and `current` swaps, in that order: a death before `carried` leaves an ask the next start carries again, finding the returned stores already fitting and keeping their first copies. The previous release starts through the same Succession handover as a restart, and the returner leaves only after it serves, dropping the copies once the attempt has passed. `current` never stands on a release that refuses the data; pruning keeps both releases a standing step back names, and an install abandons only a step back not yet carried.
- **Either side failing puts the data back.** A return or a swap that fails restores the copies, moves `current` back only off its own swap — an install that moved it meanwhile keeps its choice — and records the reason in `back.json.failed`, which the release channel and the checkout runner show once as the installation's failed outcome. Copies that do not all come back leave the step back standing and refuse that start, so the next start takes the return up again rather than serve half-returned data. A previous release that falls before its door rolls back its own attempt copies — the returned data — and the leaving build raised after it restores the `.back` copies. A start of any build settles what stands under its own data lock before entering an attempt: restore after an ended attempt, drop the copies once the target served, wait while the attempt record does not read.
- **Only the asked build takes the handover.** The CLI phase consumes a predecessor's handover only when this build is the record's `from` and `current`; every other start leaves it to the server, so a build that is itself the target never answers `Serving` before its door.
- **An unfit `current` becomes a step back.** A restart whose `current` cannot open the data — any store's ledger naming a migration its chains lack — is turned into a step back asked through the running build: `current` returns to it and the record names the other release. Every door that steps back with a server running asks that server, so `current` moves only once the data fits.
- **Journal forms are not returned.** A thread journal the leaving build already cast with a form step the previous release lacks stays in that form: form steps are forward-only, and the older build cannot shape that thread until the newer build stands again.
- **Execution hosts.** An idle host's `executions.sqlite` is returned with the other stores; a running host returns its own as it yields to the older bundle.
