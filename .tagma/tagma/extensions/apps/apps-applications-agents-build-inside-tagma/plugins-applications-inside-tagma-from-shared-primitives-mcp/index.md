---
id: 01a1227f-7522-78e3-a658-79b7a0a16218
title: "Plugins: applications inside Tagma from shared primitives — MCP process, MCP Apps view, own agents, owner-held contribution points"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**Result.** A user asks an agent “make me X”, and X appears inside Tagma: it works at once, with no deploy, on desktop and web, later on the phone. It can be a game in a window, a CRM with its own database, a language trainer with a tutor agent, a poker table where agents play, a trading desk on a schedule, or a bridge to Slack. Tagma knows none of these scenarios. It gives a small set of shared primitives, and every scenario is assembled from them without touching Tagma's code.

The main criterion: the next capability arrives as a new contribution point at its owner. The manifest envelope, the process protocol, the view bridge, and the caller shape do not break.

The spec was consolidated by thread 01a113e4's lead after analysis by two assistants. The reports lie in the `plugins-astra` (01a12269-41d2-7541-bf62-a79988c6f9fd) and `plugins-critic` (01a12269-41d2-7541-bf62-a79a99ed2926) threads' scratch. The basis is idea [[21acc718]] and poker [[9caf5753]].

## What a plugin is

A plugin is a directory with a `plugin.json` manifest. Every part is optional. A minimal plugin is one view with no process.

```
<plugin>/
  plugin.json      envelope and contributions
  server/          process: any language, stdio MCP
  ui/              static web build of views
  agents/*.md      agent definitions
```

A plugin is one more client of what already exists in Tagma. It does not extend the operation catalog: its actions are its MCP tools. Core modules stay static (`composition/manifest.ts`). Only the registration of plugin contributions becomes dynamic, and only at the owners the plugin writes to.

An adapter — a model provider of its own, a CLI-agent transport, a sandbox engine, a speech provider — is not a plugin. An adapter carries different trust (code in the server process), a different lifecycle (loads into the server process, never unloads), and a different contract (the owner's typed contract, not a wire). It needs no shared manifest with plugins. They share one principle: the client learns the variants over the wire, not by import. Model-provider adapters are spec [[52b10a62]].

## Manifest

JSON. Tagma reads it without executing the plugin's code. The schema is set in Effect Schema, generating JSON Schema for authors. No `version` field is introduced; the envelope changes only by addition. A field with no working semantics is never shipped: a reserved field later becomes a contract.

```json
{
  "id": "poker",
  "title": "Poker",
  "process": { "command": "bun", "args": ["server/main.ts"] },
  "contributes": {
    "tools":    [{ "name": "act", "audience": "own" }, { "name": "deal", "audience": "view" }],
    "agents":   [{ "id": "player", "path": "agents/player.md" }],
    "views":    [{ "id": "table", "entry": "ui/table.html", "live": true }],
    "pins":     [{ "view": "table" }],
    "results":  [{ "tool": "look", "view": "hand" }],
    "launchers":[{ "view": "table", "title": "Open table" }],
    "on":       { "ended": "player_ended" }
  }
}
```

- **Envelope:** `id`, `title`, `process`, `contributes`. The `plugins` module parses the envelope. Each point in `contributes` is declared by its owner with a schema, a collision rule, registration and teardown. `plugins` hands the declaration to the owner and never branches on the point's name. An unknown point is a refusal naming it; nothing is silently lost.
- **Each point's schema lives in its owner's server wire, even when a client draws it.** `pins` sits at `threads` next to `pin_view`; `views`, `results`, and `launchers` sit in the `plugins` module's wire. The server checks the whole manifest, and the client receives already-checked contributions over the plugin feed.
- **A contribution's address** is the “plugin, contribution” pair. Paths inside the package are relative; the host reports absolute paths.
- **View, mounting, and resource are different things.** A view (`views`) is an interface. Mounting (`pins`, `results`, `launchers`, later `surfaces` and `panes`) is where it lives. A resource is the plugin's object, e.g. a table. The process holds its state, not the iframe. One table view mounts into a tool's result, above the ribbon, and in a window, with no copies.

## Process

- **One process per plugin root per machine.** The project arrives in each call's caller. Why not a process per project: Slack and Linear bridges hold one connection (Socket Mode splits events across N processes), CRM and trading are personal, and N projects × M plugin processes cost memory. The same `id` in two roots is a refusal naming both paths. The project floor is read from the project's main checkout, not its worktree.
- **Its own supervisor.** The `plugins` module holds one `openMcpSession` per plugin (`@runlith/mcp`) in its own `Scope`. `Scope.close` waits for the MCP closing and the child process exit (`sdk.ts`). Unsuitable:
  - the project pool (`mcp/serverPool.ts`) — opens lazily, only on a thread turn with the `mcp` capability, never raises a crashed process, takes declarations from user settings;
  - `McpPool` — it reconciles the list and closes the session in a separate fiber no one can await.

  The supervisor starts at boot and on enable, raises a crashed process with backoff, shows typed status and launch diagnostics. The plugin files' revision sits in the process env: a code edit restarts the process.
- **Restart with no two writers.** Order:
  1. check the new declaration;
  2. close new calls to the old process;
  3. await started ones or cancel them;
  4. close the old process's `Scope`;
  5. start the new one;
  6. publish the contributions.

  An error before step 4 leaves the old process running. One after it reads as failed. Editing views alone does not restart the process.
- **Tagma → plugin — over MCP.** Agents and views call the process's tools. The end of a plugin-born thread is delivered through the already-standing durable run-end notification obligation: claim, confirm, retry, `notification-exhausted` (`packages/agent/src/thread/storage/settlement.ts`, visible in `read_endings`). Tagma finds the recipient by the plugin's key in the thread's `bindings`. The confirmation is the tool's answer from `on.ended`. Delivery is at-least-once, so the plugin is idempotent on `runId`. An end that landed on a process restart is not lost. The process has no subscription to Tagma's live feeds: thread feeds are open only to the operator and speak the internal Effect RPC protocol.
- **Plugin → Tagma — operations over HTTP**, as `tagma op`: JSON in any language. The process gets the server address and the `plugin:<id>` caller name in env.
- **Plugin → view — the plugin's resource.** The process sends the standard `notifications/resources/updated` on the resource URI. Tagma subscribes via `resources/subscribe`, and the view reads state with `resources/read`. No custom notification method is introduced: the typed MCP SDK sends only standard ones, and a custom one would break “any language”. This matches the “resource is the plugin's object” model.

## Caller

- **A plugin is an outside caller** (`x-tagma-caller`, `{kind:'external', name:'plugin:<id>'}`, `admission/identity.ts`). The plugin gets no caller kind or grant of its own, as [[9f3bb3f9]] requires.
- **No rights and no rights screen on stages 1–3**, and the spec says so directly. The plugin's process runs with the OS user's powers and can reach the local door with no headers, so an allowlist in the manifest would guard nothing. Our own plugins are trusted under rule [[06e41b6f]]. Rights with enforcement arrive only with the foreign-process sandbox. That is stage 4, outside the spec.
- **The caller in `_meta` (`runlith/caller`) becomes a tagged union already now**, because it is the plugin's input contract. Every variant shares `projectId: number | null`: the process is one per machine, and it learns the project only from here. Variants:
  - `agent {agentId, ownerId, thread: {threadId, runId, bindings} | null}`. `thread: null` keeps a threadless `AgentRunner` (`AgentRunner.ts`), as [[b771b4db]] requires;
  - `operator {view, threadId?, bindings?}` — a call from a view by a person;
  - `tagma {reason}` — a Tagma event or schedule tick.

  The host, not the tool's arguments, fills in the project and the initiator. The union is the wire type owned by `packages/mcp` (`mcpCallerMeta`). The agent's `ToolCaller` (`packages/agent/src/agent/contracts.ts`) is unchanged and maps to the `agent` variant: agent tools never receive variants they cannot have. There is no fake `agentId` for the operator.
- **Thread birth by the plugin.** `create_thread` gains a `bindings` field on the wire: storage already has it (`threads/store/mandate.ts`), the wire does not (`threads/contract/wire/creation.ts`). The operation opens to the outside caller. The thread is woken by the outside admit ([[9f3bb3f9]]). A plugin's thread is an ordinary Tagma thread: visible, openable, stoppable, readable. The limit is the existing thread budget; there is no separate counter.

## Tools and agents

- **A tool's audience:**
  - `agents` — a deferred tool for all agents in projects where the plugin is enabled (CRM);
  - `own` — eager, only to the plugin's agents via the `plugin:<id>` capability (`look`, `act`);
  - `view` — only to the view bridge (`deal`).

  Plugin tools do not enter the project's MCP palette.
- **Package agents are the third floor of `declaredAgents`** (`threads/library/declared.ts`) with ids `<plugin>.<agent>`, e.g. `poker.player`. The agent-name schema forbids the `/` separator, and the `agentId` sits on the thread's row, so it must be chosen now. `AgentDefinitions` (`register` returns a disposer) registers only the `plugin:<id>` capability. A definition may withhold Tagma's standard tools: a poker player needs no bash. Players are born in `trust` mode, or a `mutates` tool would ask the operator on every turn.
- **The person's action question** is assembled from what already exists. A `mutates` tool in review mode asks the operator (`ASKS_IN_REVIEW`, `mcpToolCatalog.ts`), the question lands in “Attention” and in push. That gives the trading desk confirmation of every order with no new mechanism.

## View and bridge

- **The bridge is the MCP Apps protocol.** JSON-RPC 2.0 over postMessage, `ui/initialize`, `tools/call`, `resources/read` and `resources/subscribe`, context, sizes, teardown. Tagma's capabilities for its own plugins are named extensions `tagma/*` of the same protocol:
  - `tagma/open` — a thread, panel, or section through `ShellOps`;
  - `tagma/storage` — the view's key-value store;
  - `tagma/thread` — a narrow stable thread projection: text and run status. The thread's internal feed is never handed to a plugin: its shape changes with every edit.

  No `tagma/op` (an arbitrary Tagma operation from a view) is introduced until a scenario needs it. Short functions like `call()` live only in the SDK; there is no second protocol.
- **The host binds the connection to the mounting and the plugin.** The iframe chooses neither its plugin, its caller, nor its rights. Subscriptions and outstanding requests belong to the mounting and end with it. A missing capability answers `unavailable`.
- **A foreign MCP App gets only the standard:** `ui/*` and `tools/call` to its own server's tools with `visibility: app`. It gets `unavailable` for all `tagma/*`. Foreign HTML from an outside MCP server never acts on the operator's behalf.
- **A plugin view's isolation is the plugin's own origin.** A view is an ordinary page with its own origin: an opaque origin inherits into nested frames and breaks any third-party widget (the YouTube player inside a view crashed with `writeEmbed is not defined`). Locally the origin is `http://<plugin>.localhost:<sandbox port>`, remotely it is the plugin's own HTTPS port on the Tailscale Serve node (one hostname per node, so the origin differs by port). The door announces the origin in the views feed; until the remote site is ready, the view shows the cause while the main access stays ready.
  - The sandbox listener serves the plugin's code only at its origin, choosing the plugin by Host; the Tagma door refuses these origins (`origin-refused`), and the site's `frame-ancestors` admit only loopback pages and the remote door. Plugins cannot reach each other, the door, or the MCP App proxy. Remotely origins differ only by port, so cookies set by views themselves are shared across plugins; the remote door refuses requests with `Sec-Fetch-Site: same-site`.
  - The view's iframe gets `allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups` (view windows stay in the sandbox), `allow` — fullscreen, sound autoplay, encrypted-media, picture-in-picture. Browser storage is per-plugin; `tagma/storage` is server storage shared across devices.
  - The view's CSP permits `'wasm-unsafe-eval'` and outside sources from `views[].csp`. Site files are code, not data: they are served ahead of the device gates with `Access-Control-Allow-Origin: *`.
- **A foreign MCP App is two layers, as MCP Apps requires (the Sandbox proxy section).** Tagma's app embeds a proxy on a separate sandbox origin (remotely — the second Serve port), the proxy lays the HTML into a `srcdoc` opaque frame. Losing that port disables only MCP App views (`sandboxOrigin: null`).
- **Live and static views.** A view declares `live`. `keepAlive` moves to `ToolKind` (`EntryKinds.svelte.ts`). A live view in a tool's result holds the iframe past the scroll window within a 4-line budget ([[8d75d711]]). A static one unmounts when it leaves the window. 150 hands each with a live iframe is an unacceptable price ([[fe83acfa]]).
- **Pinning is a thread fact on the server.** The `pin_view` and `unpin_view` operations (thread, plugin, view, resource key) are open to the operator and the outside caller. The set arrives in the thread snapshot. The region is capped at a third of the height (`PinnedRegion.svelte`): what is above is a window or a panel.
- **The host's client half.** The app's `plugins` feature subscribes to the enabled-plugins feed and registers their contributions in the client registries (`EntryKinds`, `FeedRegions`, later the section registry), each registration with a disposer. The server never writes to the browser's registries.

## Ribbon entries

On stages 1–3 a plugin writes no ribbon entries. A tool result with a view, the pinned entry, and the admit message cover all six scenarios. If an entry is ever needed, it will be one link `{plugin, view, key, modelText}`, with the data staying at the plugin. After the plugin is removed such an entry reads as `modelText` plus “view unavailable”. The plugin's JSON schema is excluded from the transcript for three reasons:
- `ThreadEntryReader` is immutable and reads Effect Schema;
- entries live forever, and their shape cannot be migrated after a plugin edit;
- without `modelText` the entry's agent sees nothing.

## Where it lies and what it stores

- **Discovery is two floors, like agents** (`threads/library/declared.ts`): `<project>/.plugins/<id>/` (after the `.agents` pattern) and `~/.tagma/plugins/<id>/`. The project's `.tagma/` directory is not used: `.tagma/**` is the graph tree (`graph/contract/wire/storage.ts`), and the plugin's package would fall under graph delivery. The runlith monorepo's plugins are the runlith project floor. An agent assembling a plugin writes it to the project floor.
- **Install is a machine record `{id, source, enabled}`.** It decides whether the process runs, independent of projects: the background bridge works with no project open. A directory with the same `id` from another source is an explicit collision with a refusal, not a silent substitution. Deleting a project does not delete this record.
- **Per-project enable** decides only the visibility of tools and views in that project.
- **Data** is `~/.tagma/plugin-data/<id>/`, per plugin, not per machine `projectId`. When a split by projects is needed, the plugin splits itself on the caller's `projectId`.
- **Removing a plugin does not wipe its data.** Removing a program and wiping a CRM are different intentions. Data is wiped by a separate operation.
- **Deleting a project** drops its enables and its pinned entries; the plugin's process keeps running.

## Contribution points by stage

| Stage | Points | Owner |
|---|---|---|
| 1 | `tools`, `agents`, `on` | `plugins`, the agent library (`declaredAgents`), `AgentDefinitions` |
| 2 | `views`, `results`, `pins`, `launchers`, window | the kit ribbon, the app shell |
| 3 | `surfaces`, `panes`, `schedule`, `secrets`, `notify`, speech | the shell, the new schedule and secrets owners, push, speech |

- **Window** — one place called “separate window” with platform adapters: an OS window on desktop, a floating panel on web. `floating` and `window` are not separated.
- **Starting without a process.** A view without a tool opens via `launchers` from the palette and rail. That is how Doom starts.
- **A plugin's section** is the shared route `/[project]/p/[plugin]/[view]` with live section registration. The icon is passed as a URL, not a Svelte component. This is the work [[30b488ab]] hands directly to the plugins spec.
- **Schedule** is a small new owner; recap is not it. One run at a time; ticks missed in machine sleep or at a stop do not accumulate: after waking one run goes. Failure and the next run's time are visible. It does not keep the machine awake.
- **Secrets** are a store the operator fills in the plugin's settings. Values go to the process in env and are registered with the redactor.
- **Notify** is a new “Attention” source beside threads; push delivers it. The phone's answer is a durable question with an id and an outcome, push carries only its link.
- **Speech** is the `tagma/speech` bridge over the existing speech feeds (`speech/contract/wire/feeds.ts`, `callers: 'any'`). No plugin runs its own STT.

## Stages and acceptance

**The acceptance rule.** Once a stage's primitives stand, the stage's accepter plugin is created with changes to its own package only. When Tagma had to be edited, a shared contract is missing, and the work returns to its owner.

1. **Runtime.** The `plugins` module and its supervisor; the manifest envelope; end delivery through the notification obligation; the `tools`, `agents`, `on` points; the outside `plugin:<id>` caller; `create_thread` with `bindings`; the caller in `_meta` as a tagged union; the data folder; restart on edit.
   - The accepter is text poker: a dealer process, players on different models, a person moving with a tool.
   - Check: a player sees only its own cards; the table survives a process restart; no second dealer appears after an edit.
   - Measure: a table of 9 players and a dealer completes 50 hands with no stalls; CPU, event-loop lag, and memory per idle thread recorded. Before the stage begins, check whether `@runlith/llm` has a parallel-request limiter on the provider account.
2. **Views.** The MCP Apps bridge; the plugin's own origin locally and on the remote door; the `views`, `results`, `pins`, `launchers` points, the window; `pin_view`; `keepAlive` at `ToolKind`; the plugin's resource with a subscription as the “process → view” channel; `tagma/thread`.
   - Accepters: a poker table with player thoughts; Doom with no process; a third-party MCP App with no Tagma SDK. Three different cases: live state, a static view, and a foreign interface.
   - For the third-party MCP App the `packages/mcp` owner adds the client's capabilities, descriptor and result `_meta` preservation, `resources/read`, and filtering tools by `visibility: ["app"]`.
   - Works on desktop and web.
3. **Apps and background.** Sections and panels, schedule, secrets, notify, speech.
   - Accepters: a CRM with a direct URL and recovery after reload; a read-only Linear or Slack bridge on a schedule with a secret.
   - Window closing, project deletion, and process restart do not break the lifecycle.

## What the executor checks

- **Host:** enabling registers contributions at owners, disabling removes all, re-enabling after an edit does not duplicate, an unknown point yields a refusal naming it.
- **Supervisor:** a crashed process rises; on restart the old process is closed before the new one starts; a thread end that landed on a restart is delivered after it.
- **Caller:** an agent's call, a view's call, and a Tagma event reach the process in `_meta` as three different union variants.
- **Audience:** an `own` tool is invisible to an ordinary agent, a `view` tool to no agent at all.
- **Bridge:** an iframe cannot name itself another plugin; the mounting's subscriptions drop with it.
- **The plugin's origin:** the plugin's code is served only at its origin, the door refuses plugin origins, a third-party widget works inside the view.
- The stages' accepter plugins.

## What the operator checks

Poker, Doom, and CRM look and work as part of Tagma. An agent assembles a plugin on request, and the plugin appears with no server restart.

## Outside the spec

- Foreign plugins, the process sandbox, rights with enforcement, the catalog, payment, a stable public SDK — stage 4.
- Plugins that add operations to the catalog, change the agent's run, or draw their own views of graph blocks. A graph block's view will later arrive as a graph contribution point, touching neither the envelope nor the bridge.
- Adapters are a separate spec.
