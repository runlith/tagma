---
id: 01a195a6-3b89-7c0f-837f-08668c5b6812
title: A module's GET route joins the HTTP door from its manifest under one owner, and only a route declared pre-admitted is reached on the remote door before device admission
ord: 43
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a10c6e-f97d-7670-a3d6-9058843f8d21
  - kind: relates
    to: 01a1956f-1d5b-7679-82e2-dd7903cec1d8
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/route.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/door.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/door.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/remote.ts
---
A module serves a browser round trip — a sign-in that returns to the machine — by listing `routes` in its server manifest, built with `route()`. Composition adds every route to the HTTP door as a GET, building each handler from the door's own context, so one route answers differently on the local and the remote door. Its return address comes from `DoorAddress` in that same context: on the local door, the origin it actually listens on; on the remote door, the remote origin, null while remote access is not ready.

A route's path is exact and already in the normalized form the router and the remote gate compare (lowercase, decoded, no repeated or trailing slashes, no wildcard or parameter). Assembly refuses a path in any other form, one path declared by two modules, and a path equal to or under one the door serves itself (`DOOR_PATHS` in `http/door.ts`). Without these refusals, two owners would race for one path, or a module path would shadow the API or the app, and a pre-admitted path would be compared in a form the router never sees.

`preAdmitted: true` says the route's single-use state is its only credential. The remote door then hands a GET to exactly that path to that handler alone, before device admission and without the app's router, so no other handler, prefix or wildcard is reachable that way. Such a handler runs with no admitted device: `CallDevice` stays at its default, the local operator, so it must invoke no operation and read no device. Every route not declared pre-admitted is local only: on the remote door an unadmitted read of it gets the shell.
