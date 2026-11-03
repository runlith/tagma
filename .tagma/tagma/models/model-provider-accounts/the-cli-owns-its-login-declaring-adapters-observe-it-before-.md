---
id: 01a1361f-cf4d-7f3a-a38e-90833b360b13
title: The CLI owns its login; declaring adapters observe it before a model is chosen
ord: 8
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a12c5a-e14b-7f23-b49a-56a5c8041df5
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/defaultLogins.ts
---
The CLI remains the authority for its subscription login: discovery records status, never derives it from a credential file. An adapter declaring its login place and files is observed at startup, on those files changing, and on focus while it is not known signed in; undeclared CLIs still require an addressed act. Only a signed observation opens the selected-provider paths. Readiness prevents an early model-default read or birth from declaring the installation unconnected while discovery can still find a login. A failed watch acquisition releases its registration without becoming a login verdict; focus and installation changes reacquire lost watches and recheck status across the unobserved gap. Status waits for the CLI's exit rather than elapsed time: startup load cannot prove a working login lost. A signed-out answer preserves account addresses and defaults; an unreadable answer preserves the previous identity and carries its problem. Profile-selected directories are new spelling-exact addresses, so neither later profile changes nor old watchers retarget an earlier account.