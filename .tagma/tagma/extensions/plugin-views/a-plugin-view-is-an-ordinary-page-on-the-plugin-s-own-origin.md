---
id: 01a125b9-ef31-7aa6-ac12-e7dda9714f0d
title: A plugin view is an ordinary page on the plugin's own origin, and the sandbox serves the plugin's code only on that origin
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1258b-4bed-7190-a24c-92dbc781ec39
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/views/reach.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/views/ViewFrame.svelte
  - kind: file
    ref: apps/tagma/server/src/composition/http/sites.ts
  - kind: file
    ref: apps/tagma/server/src/remote/keeper.ts
  - kind: file
    ref: apps/tagma/server/src/views/files.ts
---
A view is plugin code that embeds third-party widgets, so it runs as an ordinary page with its own origin: `sandbox` flags are inherited by nested frames, and an opaque view broke every widget with its own origin (the YouTube player failed with `writeEmbed is not defined`). Isolation rests on origin difference.

- **The door announces the origin.** The feed's `views.subscribe` set carries the `site` from the `ViewSites` of the door the feed came through: locally `http://<plugin>.localhost:<sandbox port>`, remotely the plugin's own HTTPS port on the Tailscale node ([[a7089c76]]), and `unserved` with a reason while it is not ready. The client resolves the view's `entry` and section `icon` against that origin and never renders the origin itself.
- **Plugin code only on its own origin.** The sandbox listener picks the plugin by a single Host (`<id>.localhost` or the remote site from `PlacedSites.at`), not by path. The proxy MCP App answers only on the loopback Host and the remote sandbox origin; everything else is 404. Code opened on someone else's origin would share an origin with a neighbor or the proxy and speak to the bridge on their behalf.
- **IPv6.** Browsers look `*.localhost` up on `::1` first, so the sandbox also holds the port on `[::1]`. When another program holds it, local views refuse with a reason: otherwise it would answer under any plugin's origin. A machine without IPv6 loopback does not need this port.
- **One site per plugin locally only.** `localhost` is a public suffix, so each `<id>.localhost` is its own site: cookies are shared neither between plugins nor with the door. Remote sites differ only by port and share one site with the door: script-set cookies from a view are visible to all plugins, and the device (`HttpOnly`) cookie leaves with their requests too. So the remote door refuses any request with `Sec-Fetch-Site: same-site` or `cross-site` as `origin-refused`.
- **Site answer.** CSP without `sandbox` (otherwise the view would be opaque again); `frame-ancestors` — the loopback pages of this machine and the stored remote-door origin. `Access-Control-Allow-Origin: *`: files are code, and the shell pulls the icon mask with a CORS request. No referrer policy is set: YouTube refuses embedding without a Referer.
- **The view iframe** gets `allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups` — nested frames and windows the view opens inherit these — plus `allow` with fullscreen, autoplay, encrypted-media, and picture-in-picture, which a nested frame gets only when the view delegates them with its own `allow`. `allow-same-origin` is safe because the view's origin never matches the embedding page's origin. A window opened by a view stays in the sandbox: leaving it could have taken Tagma's tab to someone else's address.
- **A browser without `*.localhost`.** Chromium (and Electron) resolves these names itself; Safari uses the system resolver, which on some macOS versions does not know them. Before mounting, `ViewFrame` makes a no-cors `HEAD` request of the view page (no longer than 10 seconds), reports on failure that the browser cannot reach the addresses, and retries on window focus and network return.

Each plugin's browser storage is per origin (local and remote differ); `tagma/storage` is server-side storage shared across devices.
