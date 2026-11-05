---
id: 01a1ad0c-9c6d-75f8-b5b7-b2a7c1891844
title: One plugin from a theme to a whole application, written against a published SDK
ord: 56
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a118ac-1a50-7aba-9bbf-abf721acc718
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09415a61526
  - kind: relates
    to: 01a14c37-8e71-7053-9adc-c10225c23522
  - kind: relates
    to: 01a1788a-82be-7963-ab97-da3159a77704
  - kind: relates
    to: 01a184a7-bd46-7bf8-8006-9e1db540be67
---
Draft from a design conversation with the operator on 2026-11-05. Nothing here is accepted yet: it moves to a #spec once the open questions below are answered. "Agreed" means the operator stated it or took it without objection; "proposed" means the agent recommended it and the operator has not ruled.

**The question.** Should everything that extends Tagma be one thing, the plugin, written in code against a published SDK, from a theme to a whole application inside or beside the window?

**Why.** Today code that extends Tagma arrives through three installers with three vocabularies: `install_app`, `install_plugin`, `install_adapter`. A person who wants to extend Tagma must first learn which one applies. The most capable of them, the app, is written by hand: a `tagma-app.json`, the raw MCP SDK and raw `POST /api/op/<operation>` calls. No package gives an author types, no generator starts one, no marketplace carries one. Under it the core is sound: contribution points and operations declared with schemas are what such an SDK would stand on.

## Agreed

- **One term.** The product says plugin. "App" stops being a product term and may remain a word in promotion. "Tagma app" is never used: it names the client itself.
- **Our format is the full one.** A foreign package (Claude Code, Codex, any format wanted later) is translated into it by a translator the person never sees, and shows in one list with its source marked. `plugin-formats` already translates, but into a reduced shelf of skills, commands, servers and agents rather than the full plugin.
- **A bare MCP server is not a plugin.** It is a connection — a command or URL with its secrets and sign-in, carrying no author, version or files — and keeps its own name and list, as in nearly every agent tool. A plugin may bring servers into that list, marked with the plugin and switched on and off with it; `add_mcp_server` stays the act of connecting one.
- **Range.** A plugin may be a theme, a sidebar button, a custom section for a service, a separate tool such as a language trainer, or a launcher-style application in its own window that uses Tagma's agents. Size changes what it declares, never what it is.
- **Everything at the side is a plugin.** Model providers, agent CLIs and speech providers included; a built-in one is a plugin that ships with Tagma. Model and harness adapters already install at run time. Speech providers have a contract but are compiled in.
- **MCP is the wire.** A plugin process keeps speaking MCP over stdio, which is what makes any language possible. A server's MCP App window leaves the view core: it becomes a module view of the MCP client that wraps an iframe.
- **Code, then manifest.** An author, or an agent asked to build one, writes TypeScript against the SDK. A manifest still exists, because Tagma must know what a plugin offers without running it: for the catalog, for consent, for a plugin with no process, and to refuse a broken version while the old one runs. The build emits it; nobody writes it by hand.

## Proposed

**Packages.** `@runlith/tagma-sdk` is today's private `@runlith/tagma` published under a new name, gaining a `/plugin` entry beside `/rules` and `/adapter/*`. `create-tagma` backs `npm create tagma`. The bare `@runlith/tagma` stays reserved for the product itself. Both new names were free on npm on 2026-11-05; `create-tagma` is not yet registered.

**A plugin is a package whose parts each live where they must.**

| Part | Lives | Why |
|---|---|---|
| Theme, button, command | Data in the manifest | No code, no process |
| Screens, windows, slots in the chat, composer and sidebar | A module mounted in the window | See below |
| Logic, tools, schedules, intercepting tool calls | Its own process | Any language; a crash leaves the server standing |
| Model, CLI and speech providers | Inside the server | The adapter contract shares `effect` and `Held` objects with the server and cannot cross a process boundary; synchronous work there stalls every thread, so installing one says plainly that its code runs inside Tagma |

The graph, threads, law and gates are never plugins: the product's guarantees stand on them.

**The view is a module, whatever the framework.** The contract is `mount(element, tagma)` returning a disposer. Svelte is first-class: it shares the host's runtime and gets Tagma's components. React brings its own copy, takes the look from the tokens and shows a thread through a call such as `tagma.thread(element, id)`. Vigla fits by its own `mount` once it leaves the experiment stage. An iframe becomes a tool inside a module, for MCP App windows and for embedding someone else's widget, so the core keeps one view mechanism.

The reason is what the iframe costs today: no key forwarding to the window, menus clipped at the frame, no drag bridge, about 60 CSS variables in place of components, and no way to mount a real thread. What it buys is small for a plugin with a process, which already holds all the operator's OS rights. The price of the module is real: a hung plugin hangs the window, a leak lives until reload, a plugin without a process or a third-party widget in the window holds operator rights, and whatever modules we promise become a versioned public contract. Answers to carry into the spec: load lazily, start Tagma without plugins on demand, warn at install, keep the promised list short, as `hostModules` already does for adapters.

**Three depths on the agent layer, in this order.**

1. A plugin builds its own chat over threads. Today a process can create a thread with its own agent and tools, send turns and read them. Missing: a live event stream (`thread.subscribe` is the operator's), answering approvals, listing models. The same work opens the way for a separate program beside Tagma.
2. A plugin reuses our thread. `chat-ui` becomes a component of the SDK over its `ChatConnection` port.
3. A plugin adds to our chat: elements in slots and hooks on tool calls. It adds to the conversation and never takes it over.

**A launcher-style application** needs a window without a frame, always on top, and a global shortcut. The shell has all three for its own dictation pill and quick hide; a plugin has none.

## Open

- Whether all three depths are needed: the operator allows that one may be excess.
- What exactly is promised to a plugin: which modules, which slots, which `tagma.*` calls.
- One consent rule at install. A process runs as the operator with no question today; a marketplace plugin asks.
- A real identity for a plugin. `x-tagma-caller` proves nothing, and opening approvals or streams to it needs one first.
- Distribution: one catalog, a Plugins screen in the window, machine or project scope.
- When a process starts: it now lives from install on, which a machine with many plugins will feel.
- What ships first.

## Not established

- Whether `Conversation` mounts outside its tree; it uses about twenty app services.
- How a plugin and the host coexist across Svelte versions.
- Whether the window survives a hung iframe, and whether Electron shortcuts reach out of a frame: both need a run.
- The memory cost of a plugin process.

## On acceptance

The spec overturns the split between plugin and app in [[b540be67]]; its MCP server as the wire stands. That block keeps the two apart because fitting apps into the plugin format would tie them to a standard made for agent configuration, and calling them plugins would give the word a meaning different from every neighbouring tool. This idea answers the first reason by making our format the full one and translating foreign formats into it. The second it accepts as a cost, since hosts with a single extension unit already call that unit a plugin. The spec also rewrites [[21acc718]] and [[59a77704]] in the plugin's terms, with [[15a61526]] and the `apps` skill following the code.
