---
id: 01a14fd8-3e41-7f9d-909a-f909b96e483e
title: Frontend environment arrives as graph services, not from globals, and the skill describes how an app is written on Layer and Query
ord: 37
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
sources:
  - kind: dir
    ref: apps/tagma/app/src
  - kind: dir
    ref: packages/layer/src
  - kind: dir
    ref: packages/query/src
---
## Why

The Tagma app (`apps/tagma/app`) is built on the `@runlith/layer` service graph ([[59cc3c49]]) and `@runlith/query` requests ([[1aee61f4]]): a feature declares what it needs, composition names the provider. But some code takes the environment past the graph — from browser globals and the desktop bridge. Because of that:
- one fact is derived in two places: "is it a desktop" is read by `Host` and, separately, by `window.tagmaDesktop`;
- doors to the outside world are smeared across features: API paths assembled as strings, refusals parsed by hand past `Door`;
- the app cannot be assembled whole on another environment — in the landing demo with no server, in a test, in a future shell — without touching features.

The reason it repeats is the lack of one description of how a frontend is written. Layer and Query rules reach the agent in pieces, when files are touched; a whole picture of "how a feature is written, where it takes data and environment from" lives nowhere, and there is no skill for it.

Target outcome:
1. Every door of the app to the outside world — network, desktop bridge, storage, address and navigation, browser capabilities — arrives as a graph service; only that service or the composition filling it reads the global.
2. The frontend skill in `.agents/skills/` describes how an app is written on Layer and Query, and points at real files.
3. Measurable parts are pinned by rules with a check so bypasses do not come back.

## What is already known

Found by reading, before the audit:
- **Network past `wire`:** `app/admission.ts` (`fetch('/health')`, although `Api.health` exists and `Restart`/`Standing` go through `Door.ask`), `devices/pair.ts` (endpoint declared in the server contract, call — a manual `fetch`), `checkout/PictureDiff.svelte`, `speech/calls/Player.svelte.ts` (the `/api/speech/…` path assembled as a string in the app), `threads/native/ThreadUploads.ts`, `speech/dictation/Sender.ts` (its own binary WebSocket). Shared reason: `Api` and `LiveRpc` describe JSON operations and subscriptions, while binary resources are not in the contract.
- **Legitimately past `wire`:** `service-worker.ts` (it has no graph) and `views/reach.ts` (a plugin view's origin check, not the server API); `fetch` on a `data:` URL in `screencast/Cast.svelte.ts` and `pick/Picks.ts` — decoding, not network.
- **Desktop bridge past composition:** 13 files read `window.tagmaDesktop`. Two of them repeat `Host` (`views/ViewFrame.svelte`, `shared/settingsPages.ts`); the rest take bridge capabilities — windows, dictation, folders, native pages, tab keys. A model of the correct shape already exists: `runtime.ts` picks `ViewWindows` — `NativeWindows` from the bridge or `FloatingPanels`.
- **`Platform.fetch`** exists in Layer, but `Door` does not use it and builds `FetchHttpClient` itself.
- **Unclassified:** `localStorage`/`sessionStorage` in 7 files with `Platform.storage` around; `window.location` in 5; `$app/navigation` in 22 with `Router` around; `navigator.*` in 33 (partly legitimate: clipboard, microphone).

## Design

- **Environment is services.** Every door is an app service with one subject; the feature takes it from the graph. Composition (`runtime.ts` and future demo- and recording compositions) fills it per environment: desktop bridge, browser, demo. Core and features do not branch on environment.
- **Host capability with a filler.** What only the desktop gives is declared as a service with an "unavailable" variant for web, phone and demo — after the `ViewWindows` model. If the pattern repeats more than twice, Layer gets a shared "host capability" mechanism: it does not know Tagma's capabilities, but gives a way to declare and fill them over `Host`. The decision is the implementer's, per the audit outcome.
- **Environment facts live in `Host`.** "Is it a desktop", "which OS" are read only from `Host`.
- **Network is only `wire`.** Binary routes (diff images, call sound and peaks, attachments) are declared in the server contract next to the rest, and `Door` gets byte-reading over such a route. The dictation binary sound channel is its own `wire` port. `admission` and `pair` go through `Door`. The HTTP and live transports of `Door` and `Live` are ports filled by composition.
- **Storage, address, navigation** — through `Platform` and `Router`, unless the audit finds a legitimate reason otherwise for a specific place.

## Frontend skill

The project's `.agents/skills/` catalogue, name by content (e.g. `frontend`). Dense, per the prompt-texts rule. Contains:
- **App assembly:** `App.define`, manifest and layer composition, service keys and tier, the rung ladder (app, project, thread, graph) and instance lifetimes, `Layer.provide` in composition, condition, `Prepare`, `Snapshot`, `Failure`.
- **Data:** Query repo, query, mutation, infinite, gated, reading through `.data`/`.error`/`.isFetching`; `Door.perform`/`Door.ask`, `Live.call`/`hold`; how to add an operation or subscription.
- **Environment:** `Host`, `Platform`, `Router`; how to declare a door and a host capability with a filler; that only composition reads browser and bridge globals.
- **Bindings:** `App.load`, `App.mount`, SvelteKit, prerender limits.
- **Tests:** Layer and Query testing, swapping a service for a double.
- **What not to do** — brief, with links to rules, no retelling.

The skill is written from code, not comments; each statement checked against the source. Draft — before the refactoring, so all implementers work from one model; after the refactoring the examples point at the fixed files.

## Rules

What is measurable becomes project rules with `enforce_law` (built-in `loads` check or an own one), on `gate`, with current violations as debt on refactor tasks:
- global `fetch`, `WebSocket`, `EventSource` in the app — only in `wire` and the service worker;
- `window.tagmaDesktop` — only in composition and capability fillers;
- `localStorage`/`sessionStorage` — only in `Platform`;
- the rest — per the audit.

Switching rules on with a check — on the operator's word, when the list is ready.

## Tasks

1. **App environment audit.** All of `apps/tagma/app/src` (and `packages/chat-ui` where the same bypasses are): every touch of browser globals, the desktop bridge, network, storage, address and navigation. For each: legitimate, owner duplicate or door with no port; the proposed service or port. Outcome — a table in the task and a proposal of the port and rule set.
2. **Skill draft.**
3. **Refactoring `wire`:** transports as ports, binary routes in the contract, `admission`, `pair`, the sound channel.
4. **Refactoring the bridge and `Host`:** desktop capabilities as services, `Host` duplicates.
5. **Refactoring the rest** per the audit table.
6. **Rules with a check** — on the operator's word.
7. **Skill finished** on the fixed code.

Tasks 3–5 are independent of each other and can run in parallel after 1 and 2.

## Readiness

- No feature reads `window.tagmaDesktop`, global `fetch`/`WebSocket`/`EventSource` or `localStorage` directly; the audit table's exclusions named with reasons.
- `runtime.ts` is the only place where a plain window picks environment fillers; the demo composition can assemble the same app with its own fillers without touching features.
- The skill lies in `.agents/skills/`, its statements checked against code, examples point at existing files.
- The plain window and desktop work as before; the app typecheck and tests pass.

Implementer checks: typecheck, `wire` and affected-service tests through their public doors, app and desktop builds. The operator check — desktop and phone by hand; it is not a task-completion condition.
