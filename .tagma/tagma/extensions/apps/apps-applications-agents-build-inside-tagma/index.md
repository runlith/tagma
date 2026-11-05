---
id: 01a118ac-1a50-7aba-9bbf-abf721acc718
title: "Apps: applications agents build inside Tagma"
ord: 7
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Question: make Tagma a platform where a user asks and agents build an application right inside Tagma — a game, a trainer, a tool.

Spec [[d2b5f488]] now carries this as the plugin, written against a published SDK. Where it differs from what follows, the spec decides: views run in the window as Svelte or bundled modules, with HTML pages kept framed on their own origin, the process calls Tagma's operations rather than callbacks over `@runlith/ndjson-rpc`, and "app" is no product term.

The app model:
- a package with a manifest: agents, skills, workflows, the tag dictionary, tools, widgets and their mount places, permissions;
- a process in any language — logic and state;
- widgets — a static web build on a separate origin;
- a data folder from Tagma with its own SQLite;
- the SDK — the app's only import, the boundary checked by module cards;
- agents write them on request; while apps are ours they live in the monorepo beside the SDK and change with it in one commit.

Where it lands in Tagma:
- a server module for apps: install, enable, permissions, lifecycle;
- the process — a held process on the execution host, like other CLIs' ACP processes;
- tools to agents — the project's MCP pool; Tagma passes who calls (thread, place). A call now goes as `callTool({ name, arguments })` with no `_meta`;
- app callbacks over `@runlith/ndjson-rpc`: wake your own thread, start an agent of your own definition, your threads' status, an event to the widget;
- agents — definitions with the “app X tools” capability; a definition can withhold unneeded tools;
- widgets — an origin as in artifacts, CSP per the manifest's permissions, a postMessage bridge to the server's live feed;
- mount places: the tool-result renderer (`ChatToolRenderers`), a widget pinned above the ribbon (`beforeEntries`), a panel view kind (`PANE_KIND`), its own tab (the section list in `address.ts` becomes extensible), the desktop window.

Core preparation snapshot under the former 650-line ceiling: the seams were identified where its debt stood — `features/threads/View.svelte.ts` (1181, refused commits five times since 2 October), `packages/agent/src/agent/AgentToolDoor.ts` (1208), `packages/chat-ui/src/ChatTurns.svelte.ts` (658); tasks [[175758d8]], [[2d5c76ec]], [[e239d4dc]] take them apart.

Order:
1. preparation: taking apart the thread, chat-ui, and agent-tool assembly; identity in MCP; definitions without mandatory tools;
2. the apps host without UI — poker over text tools;
3. widgets — the poker table with animations, the person's seat;
4. installing from outside, the permissions screen, the library.

Law: the “core knows no variants” rule moves outward — Tagma does not know about poker, poker knows only the SDK. Conflict: “one form, no versions” versus a stable contract for outside authors — an exception will only be needed at step 5.

Unknown: the core-preparation scope — an audit of the agent, chat-ui, and thread-view stack is needed; how Tagma holds a hundred threads; the limit on child agents.
