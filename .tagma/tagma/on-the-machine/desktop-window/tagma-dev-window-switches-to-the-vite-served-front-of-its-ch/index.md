---
id: 01a17d3f-1d04-7f62-bd64-5be6b724c701
title: Tagma Dev window switches to the Vite-served front of its checkout and always returns to the built one
ord: 29
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a13234-e0d0-7863-b40d-c3e12043c3ca
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-builds
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/StandingChip.svelte
  - kind: file
    ref: apps/tagma/desktop/src/bridge.ts
  - kind: file
    ref: apps/tagma/desktop/src/projectWindows.ts
---
A Tagma developer sees a layout edit in seconds, not after an install rebuild: the Tagma Dev window switches to the front served by Vite from the checkout and can always return to the installation's built front. No need to remember a port, and a broken dev front cannot lock the window.

## Developer only

An ordinary user has none of this: no operation, no card row, no menu items, no bridge member.
- Server: the operation comes from the [[2043c3ca|checkout builds]] module, wired only into the developer composition. The release composition has no such catalog entry.
- Desktop: only a build without a release number (`numbered` false — a checkout build) opened at no fixed address (`--tagma-surface-url`) has it. A release has neither the `surface` bridge member nor the menu items.

## Dev server

The `start_dev_surface` operation of the checkout-builds module. The address is `http://localhost:<surfaceDevPort(server port)>/`, derived from the server port as in `surfaceConfig.ts` and `desktop/scripts/dev.ts`.
- If Vite already answers at the address (e.g. an agent started it), the operation takes it and does not start a second one.
- Otherwise it starts the checkout's app Vite (`apps/tagma/app`, `bun run --bun vite`) in the operator's held terminal with a clear label. The server port passes through `TAGMA_PORT`, `TAGMA_SURFACE_OUT` is removed. The terminal is visible in Tagma terminals, its output is readable by the operator and agents, and it survives window reload.
- The operation answers with the address once Vite has answered. If the terminal exited earlier (e.g. a foreign process holds the port), the operation refuses and attaches the output tail. If the checkout is unknown, it refuses with its own code.
- The operation does not stop Vite: the terminal is stopped like any other.

## Window

The front is a property of the project window, not the app: built (server address) or dev. Switching loads the same path on a different origin; other windows, the dictation pill, and view windows stay on the built front.
- Main trusts the dev origin for bridge, IPC, navigation, and external links only while at least one window stands on it. Main takes the dev-front address from the operation's answer.
- A failed dev-address load never reaches `SurfaceLoader`: that decides the server's fate. It rolls the window back.
- If the server is gone, everything is as now: the waiting page in all windows. When the server comes up, windows open on the built front.

## Entering and leaving

Enter from the “Surface” row in the Tagma card (`surface` bridge) and from View → Dev Surface. Both ask main, and main calls the operation and switches the window; while Vite starts, entering shows as in progress, and a refusal is shown in words.

Leaving does not depend on the dev page:
- **Corner badge** while the window is on dev: a separate `WebContentsView` in its own session (hence in its own renderer process), whose page belongs to main. It shows the window is on the dev front and offers “Built”. A white screen, an exception, the Vite error overlay, or a crashed or hung dev-page renderer do not touch it.
- **View → Built Surface** in the app menu: main draws the menu.
- **Card row** on the dev page while it is alive.
- **Automatic return** — only on fact, no timers: the dev address's main frame failed to load, the dev page's renderer died, the dev address stopped accepting connections (polling as in `SurfaceLoader.watch`). The window returns to the same path and names the cause. A compile error, the Vite overlay, and a hang do not take the window away on their own: an edit in progress or a breakpoint pause looks the same.
- **The choice is not stored**: app launch always opens the built front.

## Limit

The dev front is checkout code over the installed server and desktop bridge. Layout, components, and styles show at once through HMR. An edit needing a new operation, a new wire field, or a new bridge member breaks on the installed build; a regular installation update brings it. The badge says the window is on the dev front, so such a break cannot be mistaken for a product break.

## Acceptance

- The release composition has no `start_dev_surface`; numbered-release desktop exposes no `surface` on the bridge and adds no menu items.
- `start_dev_surface` with an answering address starts no process. With a silent one, it starts exactly one held terminal in the checkout's `apps/tagma/app` and answers after the address answers. An exited terminal gives a refusal with the output tail, an unknown checkout its own refusal.
- A window on dev shows the badge. The badge, the menu item, and the card row return it to the built front on the same path; other windows are unchanged.
- A failed dev-address load, renderer death, and dev-address connection refusal return the window on their own, with the cause named.
- After app restart all windows stand on the built front.
- Bridge IPC from the dev origin is accepted only while a window stands on it; from a foreign origin — never.
