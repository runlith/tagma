---
id: 01a10b84-bec8-7182-b0bf-018c6ab92e8d
title: "Tagma's mobile shell: the same SvelteKit app at shared URLs, choice by device, PWA"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Standing.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/runtime.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Live.ts
  - kind: file
    ref: apps/tagma/app/src/routes/+layout.svelte
---
On the phone the same app paints its own shell: "Attention", streams, the stream feed with composer. The data layer and the feed are shared with desktop; what changes are the root, a few route files, and the leaves fingers touch. Interface words are English, as across the whole UI.

## Choosing the shell

- `Host.kind` — the kit already knows `'mobile'` (`packages/layer/src/Host.ts`). `hostOf()` (`lib/app/runtime.ts`): Electron → `desktop`; a stored choice → that; otherwise `(pointer: coarse) and (hover: none)` → `mobile`, otherwise `tab`. The `localStorage['tagma.shell']` key and its reading live in `lib/app/shell.ts`; there is no separate state class, everyone reads `Host.use().kind`.
- No flashing: `routes/+layout.ts` in `App.load` returns the shell component through `import()` (`LoadRun` accepts a Promise), `ssr = false`.
- The "Automatic · Phone · Desktop" choice lives in "This browser" on desktop and in the phone settings; writing it reloads the page. There is no choice in Electron. Resize switches nothing.

## Code

- Four route files become thin switches. `+layout.svelte` keeps what is shared — `App.mount`, `ModeWatcher`, dialog and snackbar hosts, pagehide, `data-pointer`; the rail, Sidebar, panels, StatusBar and hotkeys move to `lib/app/chrome/Shell.svelte`. The body of `[project]/chat/+layout.svelte` (with a new `+layout.ts`) moves to `chrome/ChatShell.svelte`, the mobile one to `mobile/ChatShell.svelte`. `+page.svelte` and `settings/+page.svelte` switch the same way.
- `lib/app/mobile/`: `Shell` (safe areas, viewport, "no connection", "not paired"), `Home`, `Threads`, `ChatShell`, `Thread`, `Header`, `Screen.svelte.ts`, `Viewport.svelte.ts`, `Elsewhere`, `Device`.
- `lib/features/devices/` — shared by both shells: `Repo`, `settings` (section), `Section` ("Phone & devices"), `Pairing.svelte.ts`, `Push.svelte.ts`, `Pair` (`/pair`), `Unpaired`. Plus `src/service-worker.ts` and `routes/pair/+page.svelte`. QR is one small dependency, SVG in tokens.
- The `ThreadOnScreen` port: on desktop `SidePanes` fills it, as now; on the phone `mobile/Screen.svelte.ts` does (`page` is the current `HarnessHost`, `shown = [page]`, `beside(id)` navigates). An opened finished stream leaves "Attention" on its own.
- Reused as-is: `Door`, `Live`, `WireState`, `Standing`, `Attention`, `Workspace`, `ThreadList`, `HarnessHost`, `DraftShelf`, `Conversation`, `ChatSurface`, `QuestionRow`, `ToolConfirmation`, `UserQuestion`, `MarkdownBody`, `CodeBody`.
- Touched leaves decide by device (`pointer-coarse:`), not by shell: touch targets at least 44 px on composer buttons and questions; on touch, Return wraps the line and sending goes by button (right now Enter always sends, and there is no Shift on iOS); the composer never takes focus by itself; draft picture removal shows without hover.
- An artifact link in the mobile feed opens in the same window through the shared resolver from [[68a2d306]]: `target="_blank"` in standalone iOS opens the built-in Safari viewer, which may lack the PWA cookies.

## Screens

A stack with no tab bar. Back is the header button or the iOS edge swipe; with no history (a cold start from push) — the parent URL.

`<machine>` in the texts below is the server machine name ([[68a2d306]]); the phone remembers the last one received, and until there is one — "your computer".

- `/` — Home: the header (`<machine>`, the connection dot, ⚙), "Waiting for you", "Failed" and "Done" groups with "Mark read", below them "Projects" with waiting and failed counters. On desktop `/` still redirects.
- `/<project>/chat` — the project's streams with status and time; "+" opens a new stream: a `Conversation` with no active stream, navigating into it after sending.
- `/<project>/chat/<id>` — the header (back, title, "project · status"), the feed, the question or confirmation dock above the composer, stop, steer during a run. A stream in terminal mode shows its status and "Open on <machine>".
- The graph, blocks, journal, checkout and rules are `Elsewhere`: "Open Tagma on <machine> to see this".
- Phone settings: shell choice, notifications, "Phone & devices".

## PWA

- Manifest: `id`, `start_url` and `scope` = `/`, `standalone`, token colors, 192, 512 and maskable icons from `favicon.svg`, `apple-touch-icon` 180. In `app.html` — `viewport-fit=cover`, `interactive-widget=resizes-content`, a `black-translucent` status bar; on desktop that changes nothing.
- Only the mobile shell registers the service worker, Electron never (`kit.serviceWorker.register: false`). Navigations are network-first with a ~4 s timeout, then the cached shell; the shell is cached by requesting `/`, not by a navigation response — with `ssr = false` the HTML is one for all addresses, and navigating to someone else's path never swaps it; `/_app/immutable/*` is cache-first as it loads. Excluded from fetch handling: `/api`, `/health`, `/_app/version.json` (`Standing` picks up a fresh build through it), WS and `/a/*`. No precache. Push and notification click live in [[c39abc78]].
- Keyboard: `Viewport.svelte.ts` keeps the root on `visualViewport` and drops the bottom safe area while the keyboard is open; composer focus on iOS never zooms the page.
- The live channel after background is a fix at the owner, `LiveConnection.attach` (`wire/Live.ts`): back after hiding longer than the ping period — reconnect at once, feeds receive a snapshot. Right now the zombie socket after iOS background lives until the next ping.

## Connection states

- `Standing` tells a typed device refusal apart from a transport failure. Right now its `catch` (`app/chrome/Standing.svelte.ts`) turns every error into silence, and a 401 would show "Can't reach <machine>" instead of the pairing screen ([[ea465bed]]). `/health` on the remote listener answers 401 `device-unpaired` or `device-revoked` — through it, not through a socket drop, the client learns it is unpaired and stops reconnecting. Until the device is paired, no feeds start.
- `closed` for over 2 s is "Reconnecting…"; silence for over ~8 s is the "Can't reach <machine> — showing what was last loaded" badge; a cold start with no connection is the "<machine> is asleep or Tagma isn't running there, or Tailscale is off on this phone" screen with "Try again".

## Pairing on the phone

1. Camera → `https://<origin>/pair#<code>` → `/pair` exchanges the code itself → "Paired with <machine>".
2. Safari: the "Share → Add to Home Screen" hint; Android: Install. An already installed PWA and the desktop go straight to `/`.
3. In the PWA, Home shows one "Get notified when an agent needs you · Turn on" card — iOS grants permission only out of a gesture; after the answer the card is gone for good.

- iOS carries Safari cookies into the PWA when adding to the home screen — confirmed by practice, not by Apple documentation. The fallback: a PWA with no credential shows `Unpaired` with the code field.
- An expired code is a message and an input field; a revoked device is `Unpaired`. There is no unpairing from the phone itself.

## Styling

Tokens only ([[55b5437b]]): touch targets `size-11` with a `size-4` icon, rows `min-h-12 px-4 py-3`, the header `h-12` plus safe area; text `text-body`, `text-ui`, `text-small`; `@utility safe-top`, `safe-bottom`, `safe-x` in `app.css` — the spacing check rejects the name `pb-safe`; status colors are the `ThreadLife` and "Attention" tokens.

## Not building

Tab bar, sheets, non-system gestures, pull-to-refresh, offline data and precache, an in-app QR scanner, per-kind notification settings, the `/m/` prefix, copies of `Conversation` and `ChatSurface`, splash screens for every iPhone.

## Acceptance

- iPhone (Safari and PWA) and Android Chrome: the screens work, a push link opens the stream from a cold start.
- The desktop browser squeezed to 390 px stays desktop; device emulation in DevTools and the manual choice yield the mobile shell.
- Electron registers no service worker; desktop never loads the mobile screens, the phone never loads the desktop shell.
- A PWA returning from the background shows a fresh feed without waiting for ping.
- A revoked device sees `Unpaired`, not "Can't reach <machine>".
- No interface text contains the word "Mac": the machine goes by name or "your computer".
