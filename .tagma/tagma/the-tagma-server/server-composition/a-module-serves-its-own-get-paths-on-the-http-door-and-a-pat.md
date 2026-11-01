---
id: 01a1956f-1d5b-7679-82e2-dd7903cec1d8
title: A module serves its own GET paths on the HTTP door, and a path whose single-use state is its credential is admitted on the remote door before device admission
ord: 45
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a18869-931e-7cc9-af0b-6661567bdac8
  - kind: relates
    to: 01a19371-d3c3-70d3-886f-04320ac072c1
---
Paths under `apps/tagma/server/src/` unless stated.

## Why

A module that completes a browser round trip — a sign-in that returns to the machine with a code — needs a path on the HTTP door. Today the door's routes are listed in composition: `composition/http/door.ts` merges `mcpCallbackRoute` by name, and the remote door's gates (`composition/http/remote.ts`, explanation [[843f8d21]]) admit `GET /mcp/oauth/callback` before device admission by a hand-written path. A module from another composition root cannot serve such a path, and the by-name list breaks rule [[edea5454]].

## What will stand

- **A manifest declares its routes.** A module lists the GET paths it serves, each with a handler built in the serving tier from its own serving context. Composition joins every module's routes into the door generically, as it joins operations and feeds; the door names no module's path.
- **A path belongs to one module.** Two modules declaring one path refuse at assembly in `checkManifests`, like two owners of one operation id.
- **Pre-admission on the remote door is declared, not listed.** A route may declare that its single-use state is its only credential. The remote door admits a GET to such a path before device admission, comparing the path in the normalized form the router sees (lowercased, percent-decoded, no repeated or trailing slashes), exactly as it admits the MCP callback today. Every other route is served on the remote door only after device admission.
- **The MCP callback is the first route.** `mcp` declares its callback with pre-admission; `mcpCallbackRoute` leaves `door.ts` and the path leaves the remote gate. This exercises the seam inside the core.
- **One result page.** The small no-store HTML page the MCP callback answers (`mcp/callback.ts`: title, one sentence, strict CSP, `no-referrer`) moves to a shared helper at platform, so every sign-in return draws the same page.

## Acceptance

- `composition/testing/http/mcpSignIn.itest.ts` passes unchanged; `composition/testing/remote/door.itest.ts` admits the callback before device admission by its declaration and still refuses every other path without it.
- `composition/testing/extension.itest.ts` serves a test module's route through the HTTP door; the same route marked without pre-admission is refused on the remote door before device admission.
- Two modules declaring one path refuse assembly, naming both.
- The core alone, without the test module, answers that path as an unknown path.
- No file under `composition/http/` names a module's path.
- Typecheck and the affected tests pass.
