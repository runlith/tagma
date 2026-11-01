---
id: 01a195a6-3b89-7c0f-837f-08668c5b6812
title: A module's GET route joins the HTTP door from its manifest under one owner, runs as an admitted caller judged by its right, and only a route declared pre-admitted is reached on the remote door before device admission
ord: 43
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a10c6e-f97d-7670-a3d6-9058843f8d21
  - kind: relates
    to: 01a1956f-1d5b-7679-82e2-dd7903cec1d8
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/door.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/remote.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/door.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/route.ts
---
A module serves a GET of its own — a sign-in that returns to the machine, a file it keeps — by listing `routes` in its server manifest, built with `route()`. Composition adds every route to the HTTP door as a GET, building each handler from the door's own context, so one route answers differently on the local and the remote door. A return address comes from `DoorAddress` in that same context: on the local door, the origin it actually listens on; on the remote door, the remote origin, null while remote access is not ready.

A route's path is two or more segments. The first, and every literal one after it, is lowercase letters, digits, `.`, `_`, `~` and `-`, beginning with a letter or digit; a later segment may instead be a `:name` parameter, which the handler receives with the request. That plain form reads the same to the Effect router (which cuts at `;` and keeps encoded reserved characters) and to the remote gate (which lowercases, percent-decodes and collapses slashes), so `/health;x` can never be one path to assembly and another to the router. The form also leaves the app's territory alone without listing it: one-segment paths (project pages, the surface's root files, which an installation may change) and `_`-led segments such as `/_app/` stay the app's.

Assembly refuses any other form and two paths one request could match, a parameter matching any literal: two modules' paths, or a module's path and one the door serves itself (`DOOR_PATHS` in `http/door.ts`: its prefixes, each endpoint of `Api`, the retired paths). The door's `/api/` prefix is the one exception: under it a module owns `/api/<its id>/`, still refused where it meets an endpoint of `Api`. A surface that someday ships a nested file at a module's exact path is not judged.

A route not declared pre-admitted runs as a caller of the door, like an endpoint of `Api`: the door admits the call from its headers and its `project`, `cwd`, `branch` and `scope` query, and the handler receives the admitted call's project. A `right` it names is judged as a read through `Access` before the handler runs; a refused admission or right answers 409 with the refusal. On the remote door a module route reaches that admission only behind device admission, and only under `/api/`: an unadmitted read of any other path gets the shell, so a route elsewhere is local only.

`preAdmitted: true` says the route's single-use state is its only credential, so it takes no parameter and names no right. The remote door then hands a GET to exactly that path to that handler alone, before device admission and without the app's router, so no other handler, prefix or wildcard is reachable that way. Such a handler runs with no caller on either door: `CallDevice` stays at its default, the local operator, so it must invoke no operation and read no device.
