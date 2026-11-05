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
- **The Plugins screen stays the one home.**
  - Its project list splits into plugins and MCP servers; a server a plugin brought is marked with that plugin.
  - Plugins built in the project appear there with the project as their source, so apps get no screen of their own.
  - The sources stay the marketplaces. Tagma's also carries full plugins; Anthropic's and OpenAI's are translated, and what Tagma skips is named.
  - Providers install here too, while their accounts and models stay in the model settings.
  - A plugin's card names what it brings — tools, skills, agents, a section or window, a theme — and whether it runs a process on the machine.
  - The header stops speaking only of what agents can use, since a plugin also changes the window.

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

**The view is a module, whatever the framework.** A plugin's interface runs in the window without an iframe. There are two ways in.

- *Native: Svelte, later Vigla.* The plugin ships `.svelte` source, and Tagma compiles it at install with its own compiler and Tailwind. Shipped compiled, it would fail in two ways. It would break on the next Svelte update, since a compiled component imports `svelte/internal/client`, the private API of one version (5.57.0 today). And its Tailwind classes would not exist, since Tailwind emits only classes found in the sources `app.css` names. Compiled by Tagma, the plugin shares the runtime, uses Tagma's components and tokens, and may stand anywhere, rows of the chat included.
- *Foreign: React or anything else.* The plugin ships a built bundle exporting `mount(element, tagma)`, which returns a disposer, and brings its own copy of its framework. It reaches Tagma's components only through calls such as `tagma.thread(element, id)` or through custom elements, and takes its look from the token CSS variables. It survives Tagma updates as long as the promised calls hold.

Slots inside the chat, composer and sidebar take native plugins only, because a separate React root in each row of a feed whose rows are measured is costly and fragile. A screen, pane or window takes either kind. `create-tagma` produces a native plugin, and agents write native by default.

**Vigla.** If Tagma moves to Vigla, the compiler changes in one place, and every native plugin gains what Vigla may add for plugin hosts ([[6b792682]]) with no change by its author. Nothing in the plugin system waits for Vigla.

**Where an iframe remains.** It is a component a module places inside itself, never a second kind of view in the core. It stays only where the HTML is not ours:
- an MCP App window, because the MCP Apps specification requires an iframe sandbox and a server is a connection nobody installed as code;
- someone else's site or widget: a player, a map, a payment form, a sign-in page;
- a finished web application a plugin brings whole, with its own router and build, served by its process;
- pages an agent writes, already shown framed on their own origin.

The reason is what the iframe costs today: no key forwarding to the window, menus clipped at the frame, no drag bridge, about 60 CSS variables in place of components, and no way to mount a real thread. What it buys is small for a plugin with a process, which already holds all the operator's OS rights. The price of the module is real: a hung plugin hangs the window, a leak lives until reload, a plugin without a process or a third-party widget in the window holds operator rights, and whatever modules we promise become a versioned public contract. Answers to carry into the spec: load lazily, start Tagma without plugins on demand, warn at install, keep the promised list short, as `hostModules` already does for adapters.

**Three depths on the agent layer.** The operator agreed all three are needed, built in this order.

1. A plugin builds its own chat over threads. Today a process can create a thread with its own agent and tools, send turns and read them. Missing: a live event stream (`thread.subscribe` is the operator's), answering approvals, listing models. The same work opens the way for a separate program beside Tagma.
2. A plugin reuses our thread through a host component: `<Thread id>` for a native plugin, `tagma.thread(element, id)` for a foreign one, drawing the whole thread. Publishing `chat-ui` over its `ChatConnection` port was rejected in [[5a36577a]]: alone it lacks Tagma's markdown, tool renderers and model picker, and it would turn the kit's protocol types into a public contract.
3. A plugin adds to our chat: elements in slots and hooks on tool calls. It adds to the conversation and never takes it over.

**Windows and shortcuts.** Any window Tagma opens loads Tagma's own client, so a plugin's window shows real threads as the main window does. The example to accept: Mod+J opens a panel or window holding a grid of four threads on four providers. A launcher-style application also needs a window without a frame, always on top, and a global shortcut that works while Tagma is not focused. The shell has all three for its own dictation pill and quick hide; a plugin has none of them, and no keyboard shortcut either. A program Tagma does not open draws its own chat from the event stream; embedding Tagma's thread there is not needed.

## Open

- What exactly is promised to a plugin: which modules, which slots, which `tagma.*` calls, which keyboard shortcuts and window kinds.
- A real identity for a plugin. `x-tagma-caller` proves nothing, and opening approvals or streams to it needs one first.
- Distribution: one catalog, a Plugins screen in the window, machine or project scope.
- When a process starts: it now lives from install on, which a machine with many plugins will feel.
- What ships first.

Trust and consent at install belong to a separate idea, which the operator put aside as not a priority.

## Not established

- Whether `Conversation` mounts outside its tree; it uses about twenty app services.
- How a plugin and the host coexist across Svelte versions.
- Whether the window survives a hung iframe, and whether Electron shortcuts reach out of a frame: both need a run.
- The memory cost of a plugin process.

## On acceptance

The spec overturns the split between plugin and app in [[b540be67]]; its MCP server as the wire stands. That block keeps the two apart because fitting apps into the plugin format would tie them to a standard made for agent configuration, and calling them plugins would give the word a meaning different from every neighbouring tool. This idea answers the first reason by making our format the full one and translating foreign formats into it. The second it accepts as a cost, since hosts with a single extension unit already call that unit a plugin. The spec also rewrites [[21acc718]] and [[59a77704]] in the plugin's terms, with [[15a61526]] and the `apps` skill following the code. It closes [[25c23522]], since the Plugins screen takes the place of a separate apps screen.
