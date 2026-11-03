---
id: 01a1374f-c252-7955-9e10-653a492e401e
title: A pre-channel server refuses to hand over to a channel build, and the refusal's way out leads nowhere
ord: 19
tags: ["reflection"]
fields:
  {
    "actual": "`refused[no-successor]: ~/.tagma/install/current declares an installation this reader cannot take: the closure names no desktop; this server keeps running` with unblock `read_machine_state — the next installations this machine's source offers; install one, then restart`, then `installations not refreshed: no server came up on this build`. The installation landed (current → 20261013T220702948Z) while the old server keeps serving from the version kept beside it; repo hooks and .mcp.json stay on the install-path form.",
    "command": "bun run tagma:build (checkout HEAD 1ed46dfb17) while the standing server runs installation a320d883cb 20261013T135707182Z",
    "expected": "The server restarts onto the landed installation and the build refreshes every project's hooks and MCP declarations; failing that, the refusal names the way out that works: end the old server by hand (kill <pid>), then `tagma-dev web --no-open`, then `tagma-dev upgrade`."
  }
---
Filed from outside every registered project.

installation/cut/build.ts `cameUp` already carries the right words for a server that cannot take a new build (`Older`: "end it by hand, this once: kill <pid>"), but only for a server whose health answers in the old shape. A server that answers health and refuses restart_server with `no-successor` falls into `Refused` and prints the server's own unblock, which names a reading, not an act. The operator's plan for the channel move said step 1 "restarts the server on the new code"; on this machine it cannot.