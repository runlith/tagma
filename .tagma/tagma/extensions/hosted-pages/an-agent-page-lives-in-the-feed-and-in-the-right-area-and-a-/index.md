---
id: 01a16fd0-9dde-7b77-bdc0-916f13ad345a
title: An agent page lives in the feed and in the right area, and a motion page plays in the Tagma player and exports to MP4
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b08f2e1bad5a
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09001208e3e
---
## Why

An agent makes a page — a report, dashboard, plan, or motion (code-written animation) — and now hands the operator a link. The link leads to a browser or the built-in browser panel, and the result never stands where it was discussed. The published page needs to appear right in the feed as a live card. The card can move to the right area beside the thread. A motion page plays in the Tagma player and exports to MP4. The result is what Claude Motion gives in its app, only from any Tagma agent, on any plan, in any project.

The user is anyone in Tagma, in a project with or without code. A novice attaches a logo, says "make an intro", and gets a clip in the feed. An expert edits page code and timings and exports a clip of the needed size.

## What stands now

- An agent publishes a page with the built-in `artifacts` skill's `publish_artifact` tool (`apps/tagma/server/src/native-harness/skills/artifacts.ts`). The answer is `{status: 'published', url, version, versions}`, the feed draws it as a plain tool row.
- The page shelf is the `artifacts` module [[09c9ec78]]: a file path is the page identity, republication makes a new version, the shelf keeps the latest 20 versions (`storage.ts`, `KEPT_VERSIONS`), `/a/<id>/v/<version>` serves kept ones. HTTP is `composition/http/artifacts.ts`: CSP with `connect-src 'none'`, `font-src … data:`, `img-src data: blob:`; on the remote door also `sandbox`. A page cannot be deleted from the shelf.
- The Pages button in the thread header shows the thread and its team's top-50 pages as the live `artifacts.thread` feed ([[01208e3e]]).
- The feed draws a tool-call record as views via `EntryKinds` contributions in `features/threads/native/*.feed.svelte`: plugins with `kinds.registerTool({name, view})`, MCP Apps with `kinds.register({kind: 'tool', view})`, decided by record. Off-window the virtualizer unmounts the row.
- The right area opens a new place only as a tab view `PaneKind` from `features/*/panes.ts` ([[a562a1a3]]).
- The `browser` module [[97a922df]] opens pages on hosts — desktop or the managed Chromium the server installs and launches itself with no app ([[ac637dff]]) — and drives them over CDP. A `Pages.open` page is a project page record, seen by the operator; a hidden target exists only inside the managed adapter for a profile session.
- Play/pause/time transport already exists at call records (`features/speech/calls/CallPlayer.svelte`).

## The one-sentence decision

A published page becomes a feed card and a right-area tab on one shared frame. A page declaring a time scale in its file gets the Tagma player. The server captures its time frames on managed Chromium — to the agent for verification, to the operator and agent for MP4. The built-in `motion` skill teaches the agent all of it.

## Parts and order

1. [[3e6b0ad9|Time-scale contract]] — first: every other part stands on it.
2. After it, in parallel:
   - [[27686a0f|card, tab, and player]];
   - [[0fc6fa99|time frames]].
3. [[0b5eda77|MP4 clip]] — after frames.
4. [[82d49afb|motion skill]] — after the contract and frames; it needs the clip for MP4 delivery, but the skill itself can land earlier.

## Shared decisions

- **One frame for two roles.** A shared frame component — iframe, sandbox, height with ceiling, visibility mounting — with a pluggable protocol: `ViewBridge` (MCP Apps JSON-RPC) for plugin and MCP-App views, the time-scale bridge for pages. `ViewFrame` moves onto this frame in the same change; shared parts (`views/reach.ts`, `parking.ts`) are reused. No second frame implementation is written ([[dd380bf6]]).
- **Page isolation.** The page frame is `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` with no `allow-same-origin`: the same flags the remote door serves as headers. The frame origin is `"null"`, so the host sends `postMessage(…, '*')` and takes a message only on `event.source === frame.contentWindow`. `localStorage` in such a frame throws — the skill says so.
- **Address by door.** The frame URL is taken from `ServerOrigin.artifact(href)`; address copying takes the door address, not loopback.
- **One owner reads page state.** The `artifacts` module gives live reading of one page by id: current version, whether this version is kept, the version time scale, the clip state. Card, tab, and player read it; the `artifacts.thread` feed stays with the Pages button.
- **Reach.** The card draws everywhere a feed record stands — a native `publish_artifact` call: native threads and a Tagma agent on ACP (it gets the same skills and tools, and calls are written as native records). Terminal CLIs (Claude Code, Codex in PTY) get no `publish_artifact` in this work.

## What is not done

Diffusion video generation, sound and voice-over, a keyframed scale editor, shelf index redraw, page deletion.

## Checks

Acceptance criteria belong to each part. The operator separately views the card and player look and motion quality; this never conditions closing ([[a9cf196a]]).

## What remains

The contract, card, and frames are built and closed. The clip and `motion` skill code stands, but their live checks were never run: the operator banned browser checks in this work ([[c6569513]]), and with no browser the clip never encodes and an agent MP4 run never goes. What exactly stays unproven is in the clip's "What of acceptance is unproven" and the skill's "Where it stands"; both specs and this one stand open until these checks.
