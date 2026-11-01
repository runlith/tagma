---
id: 01a1956f-1d5b-7679-82e2-dd7903cec1d8
title: A module serves its own GET paths on the HTTP door and reads the door's address, and a path whose single-use state is its credential is admitted on the remote door before device admission
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

A module that completes a browser round trip — a sign-in that returns to the machine with a code — needs two things: a path on the HTTP door, and the door's address to name as the return. Today both are MCP's alone.

- The door's routes are listed in composition: `composition/http/door.ts` merges `mcpCallbackRoute` by name.
- The remote door's gates (`composition/http/remote.ts`, explanation [[843f8d21]]) admit `GET /mcp/oauth/callback` before device admission by a hand-written path.
- The door's origin reaches only MCP, as `McpSignInDoor` (`composition/http/signInDoor.ts`), in the serving context.

A module from another composition root can do neither, and the by-name list breaks rule [[edea5454]].

## What will stand

- **A manifest declares its routes.** A module lists the GET paths it serves, each an exact path with a handler built in the serving tier from its own serving context. Composition joins every module's routes into the door generically, as it joins operations and feeds; the door names no module's path.
- **A path belongs to one owner.** Assembly refuses, in `checkManifests` and naming both owners, when:
  - two modules declare one path;
  - a module's path, in the normalized form the router sees (lowercased, percent-decoded, no repeated or trailing slashes), overlaps a path the door serves itself — the API, the socket, artifacts, sites, the static app.
- **The door's address is a port the door owner fills.** The local door's origin, with the port it actually listens on, becomes a generic door-address service in the serving context, so a module forms its own return address. On the remote door it answers the remote origin, as `McpSignInDoor` does. `McpSignInDoor` becomes a reader of it.
- **Pre-admission on the remote door is declared, not listed.** A route may declare that its single-use state is its only credential.
  - The remote door admits a GET to exactly that normalized path before device admission and hands it to that route's handler alone: no prefix, wildcard or other handler is reachable that way.
  - A pre-admitted handler runs with no caller: it invokes no operation and reads no device.
  - Every other request keeps today's behaviour: an unadmitted read gets the shell, anything else goes to device admission.
- **The MCP callback is the first route.** `mcp` declares its callback with pre-admission; `mcpCallbackRoute` leaves `door.ts` and the path leaves the remote gate. This exercises the seam inside the core.
- **One result page.** The small no-store HTML page the MCP callback answers (`mcp/callback.ts`: title, one sentence, strict CSP, `no-referrer`) moves to a shared helper at platform, so every sign-in return draws the same page.

## Acceptance

- `composition/testing/http/mcpSignIn.itest.ts` passes unchanged.
- `composition/testing/remote/door.itest.ts` admits the callback before device admission by its declaration, still answers the shell to an unadmitted ordinary read such as `/pair`, and reaches no other handler through the pre-admitted path or a variant of it differing in case, encoding or slashes.
- `composition/testing/extension.itest.ts` serves a test module's route through the HTTP door on a port chosen at start. The module reads the door address from the seam and gets that port. The same route declared without pre-admission is not served before device admission on the remote door.
- Assembly refuses, naming both owners, two modules declaring one path, and a module path overlapping a door path.
- The core alone, without the test module, answers that path as an unknown path.
- No file under `composition/http/` names a module's path.
- Typecheck and the affected tests pass.
