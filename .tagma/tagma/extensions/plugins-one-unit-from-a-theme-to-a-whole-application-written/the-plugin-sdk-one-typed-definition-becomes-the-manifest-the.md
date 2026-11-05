---
id: 01a1ad53-a8b9-7fa9-98a0-71655067fa15
title: "The plugin SDK: one typed definition becomes the manifest, the process and the views, and is a plugin's only way to Tagma"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1ad4a-de84-7ddc-9396-cf6ac4451a7e
---
Child of [[d2b5f488]]. Read from the code at `11f23bfc7` on 2026-11-05 and revised after two rounds of product and architecture review the same day; nothing was run.

## Outcome

Every plugin in Tagma's format is written against `@runlith/tagma`, through its `/plugin`, `/ui` and `/testing` doors. It reaches Tagma only through the SDK, which is typed and public.

The author is an agent working at a person's request; people using Tagma do not write code (rule bb5ca896). The agent writes one TypeScript definition, and the SDK makes three things from it:
- the manifest, which Tagma reads without running the plugin;
- the process that serves the plugin's handlers;
- the views drawn in the window.

MCP, HTTP, `_meta` and the manifest's fields stay below the SDK, and an agent writing a plugin never learns them.

**The package.** One package, `@runlith/tagma`, with these doors:
- `/rules` and `/rules/effect`, as now, for `tagma.config.ts`;
- `/adapter/*`, as now, for provider code that runs inside the server;
- `/plugin`, the plugin definition and its build;
- `/ui`, for views;
- `/testing`.

`effect` becomes an optional peer, needed only by `/adapter/*` and `/rules/effect`. The bin is `tagma-plugin`.

**The plugin's folder is an ordinary package.** The agent installs `@runlith/tagma` from npm, which brings the types, and the plugin's other dependencies, with a package manager. On a machine that has no package manager, the agent installs one first; the `plugins` skill says how.

## What the author writes

One module, `plugin.ts`, exports one definition. Only `id` and `title` are required.

```ts
import { definePlugin, tool, schedule, view, hook, deny } from '@runlith/tagma/plugin';
import { z } from 'zod';

export default definePlugin({
  id: 'gitlab',
  title: 'GitLab',
  mcpServers: { gitlab: { url: 'https://gitlab.com/api/v4/mcp' } },
  tools: {
    list_mrs: tool({
      description: 'List open merge requests of a project',
      input: z.object({ project: z.string() }),
      audience: 'agents',
      readOnly: true,
      run: async ({ project }, ctx) => ctx.servers.gitlab.call('list_merge_requests', { project }),
    }),
  },
  skills: { review: './skills/review' },
  agents: { reviewer: { file: './agents/reviewer.md' } },
  views: { mrs: view('./ui/Mrs.svelte'), grid: view('./ui/Grid.svelte') },
  sections: [{ view: 'mrs', title: 'Merge requests', icon: './ui/icon.svg' }],
  windows: { grid: { view: 'grid', frame: false, onTop: true } },
  shortcuts: [{ keys: 'Mod+Alt+G', open: 'grid' }],
  schedules: { poll: schedule({ every: '1m', run: async (tick, ctx) => syncBoards(ctx) }) },
  hooks: [hook({ at: 'beforeTool', match: { tool: 'bash' }, run: async (call) => (risky(call) ? deny('…') : undefined) })],
});
```

**Fields.** Each field maps to a point its owner declares. Its type, and the check the build runs on it, come from that point's schema in the owner's `contract/wire`; the SDK never redeclares one.

| Field | Owner |
|---|---|
| `tools`, `resources`, `resident` | `plugin-host` |
| `skills`, `commands` (prompt commands), `options` | `plugins` |
| `mcpServers` | `mcp`, through its port for contributors |
| `agents` | `native-harness` |
| `secrets` | `secrets` |
| `views`, `sections`, `panes`, `windows`, `launchers`, `results`, `pins`, `shortcuts`, `actions`, `themes` | `views` |
| `schedules` | `schedule` |
| `notifications` | `notify` |
| `onThreadEnded`, `onQuestion`, `threads` (`listed`) | `threads` |
| `beforeBuild` | `checkout-builds` |
| `hooks` | the `plugin-hooks` rule ([[c4451a7e]]) |
| `providers` | `/adapter/provider` and the speech contract |

**Input schemas.** Tool and resource inputs take any validator that implements both Standard Schema, for checking, and Standard JSON Schema, for the JSON Schema an agent reads. Zod 4.2 and later, ArkType and Valibot implement both; the plugin template uses zod. Input that fails its check answers the call as `isError` with the validator's message, and the process keeps running.

**Handlers** are plain async functions `(input, ctx)`. The surface of `/plugin` and `/ui` carries no Effect. `ctx` holds:

| Field | What it is |
|---|---|
| `caller` | The `McpCaller` the host passed (`packages/mcp/src/mcpCallerMeta.ts`): an agent with its thread and bindings, the operator through a view, or Tagma itself with a reason |
| `project` | The caller's project, or null for a tick |
| `projects` | The projects where the plugin is enabled |
| `tagma` | The typed client, bound to `project`; `tagma.in(id)` reaches another enabled project |
| `servers` | `servers.<name>.call(tool, input)` for the servers the plugin brought, under their sign-in in the bound project; `servers.in(id)` for another |
| `data` | The plugin's data directory |
| `secrets` and `options` | Their values |
| `log` | Writes to stderr |
| `signal` | Aborts when the call is cancelled |
| `changed(uri)` | Tells a resource's subscribers it changed |

A handler fails by throwing. A thrown `Refusal(reason)` reaches the caller as its reason. Any other error reaches the caller as `isError` with its message, never as a protocol fault.

**Whether a plugin has a process** follows from the definition: it has one when any field carries a handler. A plugin made only of themes, views, shortcuts, skills and text prompt commands runs no process.

**Other languages.** Code in another language lives behind the definition, in an MCP server the plugin declares or in a program its handlers run.

## What the build emits

`tagma-plugin build` writes `dist/` and `tagma-plugin.json`, and type-checks the plugin first.

1. **It reads the definition** in describe mode: it imports `plugin.ts`, `definePlugin` returns a description, and no handler runs.
2. **It writes the manifest:**
   - the envelope: `id`, `title`, `version` from `package.json`, and `engines.tagma` (Versions, below);
   - `process: {entry: 'dist/process.js', resident?}`, when a handler exists;
   - `contributes` by point, each tool with its description, input JSON Schema and annotations;
   - a hash of the sources the build read.

   The catalog shows what the plugin brings before install, and agents see its tools before its process ever starts.
3. **It bundles the handlers** and their dependencies into one `dist/process.js`, so installing from npm, git or a marketplace runs no `npm install` on the person's machine.
   - The build refuses native `.node` addons, and dynamic imports it cannot bundle.
   - Tagma runs the file on its own runtime (`process.execPath`) with `--no-install`. An import that slipped out of the bundle then fails loudly instead of being fetched.
4. **It bundles a provider part** into `dist/provider.js`, against the host modules the in-server loader serves.
5. **It prepares the views.**
   - **Svelte sources.** It ships the `.svelte` and `.svelte.ts` files as source, the plugin's own and those of its dependencies.
   - **Chunks.** It bundles every other import into plain ESM chunks. Host specifiers (`svelte`, `svelte/*`, `@runlith/tagma/ui`) stay external there too.
   - **Direction.** Svelte files import chunks, never the reverse.
   - **Refusal.** A dependency that imports `svelte/internal/*` fails the build.
   - **Page views.** `view.page('./ui/board/')` copies the folder as it is.
6. **It checks the result** against the point schemas of the SDK's surface version. A manifest the server would refuse fails the build, with the reason the server would give.

The template commits `dist/` and `tagma-plugin.json`, and marks them as generated and merged as binary in `.gitattributes`. A collaborator, or an install from git, then has everything with no build of their own.

**The edit loop.** `tagma-plugin dev` rebuilds on every change. A plugin installed from a folder is read in place. A rebuild restarts its process once, and only the views that changed recompile. An agent runs the build after its edits; the `plugins` skill says so.

## The process at run time

`dist/process.js` starts the SDK's runtime with the definition. The runtime:
- serves MCP over stdio, and exits when stdin closes;
- lists exactly the tools the manifest names;
- decodes `_meta["runlith/caller"]` into `ctx.caller`, and checks inputs;
- answers resources, and their subscriptions with `notifications/resources/updated`;
- maps these onto their handlers: ticks, endings, questions, notification answers, build steps, hook calls and actions;
- calls the servers the plugin brought through the host.

The apps skill now teaches some things by hand; the runtime's code does them instead:
- stdout carries only the protocol;
- the end of stdin is watched, since `StdioServerTransport` does not watch it;
- `readOnlyHint` and `isError` carry their meaning;
- data is keyed by `projectId`.

The protocol between the runtime and the host is part of the promised surface: the shape of the caller, the names under which tools are listed, and the payloads of ticks, endings, questions, notifications, build steps, hooks and actions. So is the runtime baseline a process may rely on:
- the Bun version range of the Tagma release;
- the Node built-ins Bun implements;
- `bun:sqlite`, for a plugin that keeps its own database.

## The client

**In the process.** `ctx.tagma.op(id, input)` reaches every operation declared `external: true`, and nothing else. Its types come from those operations' input and answer schemas, in encoded form:
- it returns the operation's answer arms, discriminated by `status`;
- a refusal throws `TagmaRefused`, with `code`, `reason` and `unblock`;
- keyed acts such as `start_turn` take their `key` as a field.

Decoding is lenient, so adding to the surface never breaks a running plugin. An answer arm, a refusal code or an entry role the plugin's SDK does not know arrives as an open variant, carrying its raw value.

On top of the generated calls the SDK owns what is not a plain operation:
- `threads.events(since)`, an async iterator over the projection of the child spec, with `since` a map from thread id to that thread's position;
- `models.ask(prompt, {model, schema})`.

Typing `op` by operation id, rather than mapping operations to method names by hand, keeps the client from drifting from the catalog.

**In a view.** A Svelte view gets `tagma` from its mount's context, through `getContext`, which `@runlith/tagma/ui` wraps as `useTagma()`. A single shared module could not tell the plugins apart. This is the surface:

| Call | What it does |
|---|---|
| `tagma.tools.<name>(input)` | Calls one of the plugin's own `view` tools, typed from `typeof plugin` (`import type plugin from '../plugin'`) |
| `tagma.resource(uri)` | A reactive value |
| `tagma.storage` | The view's key-value storage |
| `tagma.threadEvents(ids)` | The reactive projection of threads |
| `<Thread id>` | The whole thread, drawn by the host |
| `tagma.speech` | Listening and speaking, as the speech bridge offers views now |
| `tagma.openLink(url)` | Opens a link, during a click |
| `tagma.open(...)` | Opens a thread or a section of Tagma |
| `tagma.servers.<name>.call(...)` | Calls a tool of a server the plugin brought |

`@runlith/tagma/ui` also exports the host's components and tokens. A view reaches only this surface, through the view host's declared methods (`BRIDGE_METHODS`). `<Thread>` is the person's own thread interface and acts as the person: placing it hands the person their own composer, not the plugin. A page view reaches the same host through the existing `tagma/*` bridge methods, which belong to the window surface.

## Where it lives in the code

- **`packages/tagma`** gains the doors `./plugin`, `./ui` and `./testing`, the `tagma-plugin` bin, and the plugin template.
  - The kit (`packages/tagma/kit/build.ts`) emits their declarations, as it does now for `/rules` and `/adapter/*`.
  - `/ui` is published as a type facade generated from the window's exports. Its implementation is the host module the window serves.
- **Schemas reach the SDK through the kit, never as a copy.** The rules doors already publish types from a private package by expanding every reference where it stands (explanation ade3bab6). The same expansion carries these into the published declarations:
  - every point's schema, from its owner's `contract/wire`;
  - the schemas of every `external` operation;
  - `McpCaller`.

  At kit build the kit also writes the JSON Schema of every point, for the build's check. The point's owner stays its only author (rule 144dfedc, explanation 7d2dc40e).
- **One plugin template.** A provider is that plugin with a `providers` field, since size never changes what a plugin is. `packages/tagma/kit/create.ts` and its adapter template fold into it. Two doors reach it:
  - inside Tagma, `create_plugin {id, title}` of `plugins` writes it into `.tagma-plugins/<id>/`;
  - outside Tagma, for instance an agent working in a repository, `tagma-plugin init` writes it.

  The agent then installs its dependencies.
- **`@runlith/tagma/testing`** runs a definition under Bun with no Tagma running. It calls a tool as a given caller, fires a tick, delivers an ending, a question or a hook call, and reads the emitted manifest. It mirrors the adapter kit's `conformance`.

## Versions

- **The surface has two parts.** Each has its own version, `major.minor`, independent of Tagma's release numbers, since Tagma releases bump their last number on `0.x`:
  - *process*: external operations, point schemas, the host protocol, the runtime baseline;
  - *window*: host modules, the view surface, the slot faces, the page-view bridge.
- **A minor adds; a major removes or changes.**
- **What a plugin declares.** `engines.tagma` names, for each part the plugin uses, the version of the SDK it was built against. A plugin with no views does not depend on the window part, so a new Svelte major leaves it running.
- **Acceptance.** Tagma accepts a plugin when each part has the same major and an equal or higher minor. Otherwise the card reads "needs a newer Tagma" with **Update Tagma**, or "outdated" with **Fix with an agent** when Tagma has moved past its major.
- **Development servers** carry the surface versions in their code, so a checkout server, whose release reads `0.1.0`, judges plugins the same way.
- **The release build checks each part by position:**
  - what plugins supply — operation inputs, manifest fields, hook answers — must still be accepted: the old type is assignable to the new;
  - what the host supplies — answers, events, payloads, `ctx`, host-module exports — must still be readable: the new type is assignable to the old, open variants allowed.

  A change that fails this check needs a major of that part.
- **The acceptance plugins** are type-checked against each new SDK and run against each new Tagma, as real consumers.

## Acceptance

- **Creating.** `create_plugin` writes a folder into `.tagma-plugins/<id>/`, and `tagma-plugin init` writes the same template elsewhere. After the agent installs dependencies, the folder builds, type-checks, and installs through one `install_plugin`.
- **The build.** `tagma-plugin build` emits `tagma-plugin.json` with each tool's JSON Schema and the source hash. A field the server would refuse fails the build with the server's reason. An unbundlable import fails it, and so does a dependency reaching `svelte/internal/*`.
- **Inputs.** A zod-typed tool shows its JSON Schema to an agent before the process first starts. Invalid input answers `isError` with the validator's message, and the process stays up.
- **The client.** `ctx.tagma.op` offers exactly the `external` operations. A refusal throws with its `code`. An unknown answer arm decodes as an open variant.
- **The plugin's own server.** `ctx.servers.gitlab.call` reaches the server the plugin brought, under its sign-in.
- **Views.**
  - A Svelte view calls its own `view` tool with the types of `typeof plugin`.
  - Two plugins' views on one screen each reach only their own tools.
  - A view that uses a Svelte component library from npm compiles against the window's runtime.
- **Installing.** A plugin installed from npm runs with no `npm install` on the machine.
- **Versions.**
  - A plugin built against process `1.2` runs on Tagma serving `1.3`, and on a checkout server serving `1.3`.
  - One built against `2.0` reads "needs a newer Tagma".
  - A plugin with no views keeps running across a window major.
- **Testing.** `@runlith/tagma/testing` calls a tool as an agent caller, fires a tick and delivers a question under Bun, with no Tagma running.
- **SDK only.** Every acceptance plugin of [[d2b5f488]] and [[c4451a7e]] is written only against the SDK, with no raw HTTP or MCP.

## Not established

- Whether Effect 4's Schema implements Standard JSON Schema; zod, ArkType and Valibot are listed as implementers.
- Whether the kit's expansion, built for the rules doors' types, carries the server's point and operation schemas without changes.
