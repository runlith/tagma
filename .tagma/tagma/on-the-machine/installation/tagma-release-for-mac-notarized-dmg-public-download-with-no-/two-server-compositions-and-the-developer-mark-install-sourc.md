---
id: 01a1320b-f60e-77ae-8fb0-4e1e6004373e
title: "Two server compositions and the developer mark: install-source port (checkout / release channel), developer modules outside the release"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
---
Spec sections "Modules" and "Public build" (composition). To do: `"tagma": {"build": "developer"}` mark for packages and a way to mark a server module; developer and release compositions (own server entry point and CLI), module list each; "next-install source" port in `installation/contract` with checkout adapter (current cut, commit window, `tagma build/update`) — release channel is another task's; machine wire and UI (`StandingChip`, `tagma status`) speak generically (next install, size, irreversibility, install, roll back). Outside the release: checkout adapter, `file_reflection`, friction prompt section, reflection target search, `performance` skill; `#reflection` type stays in the core catalog.

Done: release composition builds and starts without developer modules (metafile holds none of their entries), developer composition works as now; owner tests green.
