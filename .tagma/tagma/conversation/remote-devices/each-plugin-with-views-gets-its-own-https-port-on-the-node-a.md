---
id: 01a125bb-4451-75a5-ba96-3eb0a7089c76
title: Each plugin with views gets its own HTTPS port on the node, and the port is stored so the view origin never changes
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1258b-4bed-7190-a24c-92dbc781ec39
sources:
  - kind: file
    ref: apps/tagma/server/src/remote/contract/service/sites.ts
  - kind: file
    ref: apps/tagma/server/src/remote/placements.ts
  - kind: file
    ref: apps/tagma/server/src/remote/store/tables.ts
  - kind: file
    ref: apps/tagma/server/src/remote/tailscale/serve.ts
---
Serve gives the node one name with one certificate, so a plugin view's remote origin ([[a9714f0d]]) can differ from the door and from its neighbour only by port; cookies do not distinguish ports, and how that limits remote isolation is said there. The port range sits past the last port browsers refuse to open (10080 from the Fetch bad-ports list) and outside Funnel ports (443, 8443, 10000), so a plugin site never reaches the internet and never becomes unreachable to the browser. The mapping proxies to the sandbox listener, which picks the plugin by Host — Serve passes the request Host through as is, with the port.

- **A plugin's port is stored** in `remote_site` and survives restart and access being switched off: the view's browser storage on the phone depends on it. A port taken by someone else's mapping is replaced with the first free one not recorded for another plugin, and the new port is written before `serve`: a mapping without a record would move the site to another port on the next placement.
- **Sites are placed by `placements.ts` after the door is `ready`** from the set of plugins with views — the `WantedSites` port, which composition fills from `PluginViews.standing` — and again on every set change. A ready site is left alone, including while its plugin restarts and drops out of the set. `serve` calls go one at a time because each rewrites the tailscaled config, and each site's outcome is published as soon as it is warmed: a slow neighbour does not hold a ready site.
- **A site refusal** — including a database error reading or writing the port — touches only that site: it is visible in `read_remote_access.sites` and as `unserved` in the feed, while the door and the other sites keep working. Refused sites are placed again with a pause growing from 5 seconds to 5 minutes, and on `read_remote_access` reads, but no more than once per 5 seconds — the door waits the same.
- **Removal** when `remote.enabled` is switched off takes down mappings on any node port that proxy to the door or sandbox listener, and the terminal endpoint site on its stored port ([[2e612cfd]]). A plugin mapping that no longer exists stands until access is switched off: the code of a plugin shown to no project is not served.
