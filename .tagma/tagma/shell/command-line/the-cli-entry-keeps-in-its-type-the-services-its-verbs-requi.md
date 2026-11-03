---
id: 01a1a34d-1ec8-7d17-a053-7559fb879943
title: The CLI entry keeps in its type the services its verbs require, so a missing one fails typecheck instead of exiting 1 at runtime
ord: 9
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1a34a-0124-7059-85e5-fc29a02e6ab6
---
Found by [[a02e6ab6]]. `invoke` (`cli/invoke.ts`) casts what its lazily loaded verbs perform to `Effect<void, unknown, Command.Environment>`, and `VerbSources` loads verbs as `Record<string, unknown>` with commands typed `Command.Command.Any`. A service a verb requires therefore leaves the type. When the Stop change made `ensureServer` require `Processes`, the test copy of the CLI entry (`composition/testing/captured.ts`) did not provide it, and nothing failed at typecheck. Every `tagma web` there died with `Service not found` turned into exit code 1, and `ensureServer.itest` waited three minutes for probes nobody sent. Verb sources declare the services they need, and each entry (`composition/cli/main.ts`, `captured.ts`) must provide them at the type level. Lazy loading stays.