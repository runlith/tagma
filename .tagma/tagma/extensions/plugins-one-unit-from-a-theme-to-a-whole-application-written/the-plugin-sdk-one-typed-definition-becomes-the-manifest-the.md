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
Child of [[d2b5f488]]. Read from the code at `11f23bfc7` on 2026-11-05 and revised after a product review and an architecture review the same day; nothing was run.

## Outcome

Every plugin in Tagma's format is written against `@runlith/tagma` through its `/plugin`, `/ui` and `/testing` doors, and reaches Tagma only through it. That holds for plugins a person writes, plugins an agent writes from a prompt, and the plugins in Tagma's marketplace. The SDK is typed and public.

The author writes one TypeScript definition. From it the SDK makes three things:
- the manifest, which Tagma reads without running the plugin;
- the process that serves the plugin's handlers;
- the views drawn in the window.

MCP, HTTP, `_meta` and the fields of the manifest stay below the SDK. An author never meets them, and an agent writing a plugin never learns them.

**The package.** One package, `@runlith/tagma`, with these doors:
- `/rules` and `/rules/effect`, as now, for `tagma.config.ts`;
- `/adapter/*`, as now, for provider code that runs inside the server;
- `/plugin`, the plugin definition and its build;
- `/ui`, for views;
- `/testing`.

The doors share one version, the SDK surface version, and one declaration build, the kit. A plugin may combine parts: a provider, tools and views. `effect` becomes an optional peer dependency, needed only by `/adapter/*` and `/rules/effect`. The bin is `tagma-plugin`.

**Authors are agents.** People using Tagma do not type commands or write code: an agent writes the plugin at a person's request. Every entry point is therefore one an agent calls. There is no generator package for a person to type.

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
| `tools`, `resources` | `plugin-host` |
| `skills`, `commands`, `options` | `plugins` |
| `mcpServers` | `mcp`, through its port for contributors |
| `agents` | `native-harness` |
| `secrets` | `secrets` |
| `views`, `sections`, `panes`, `windows`, `launchers`, `results`, `pins`, `shortcuts` | `views` and the shell's server module |
| `themes` | the module that holds the `Theme` schema |
| `schedules` | `schedule` |
| `notifications` | `notify` |
| `onThreadEnded` | `threads` |
| `beforeBuild` | `checkout-builds` |
| `hooks` | the `plugin-hooks` rule ([[c4451a7e]]) |
| `providers` | `/adapter/provider` and the speech contract |
| `resident` | `plugin-host` |

**Input schemas.** Tool and resource inputs take any validator that implements Standard Schema for checking and Standard JSON Schema for the JSON Schema an agent reads. Zod 4.2 and later, ArkType and Valibot implement both, and the plugin template uses zod. Input that fails its check answers the call as `isError` with the validator's message, and the process keeps running.

**Handlers** are plain async functions `(input, ctx)`. The surface of `/plugin` and `/ui` carries no Effect. `ctx` holds:

| Field | What it is |
|---|---|
| `caller` | The `McpCaller` the host passed (`packages/mcp/src/mcpCallerMeta.ts`): an agent with its thread and bindings, the operator through a view, or Tagma itself with a reason |
| `project` | The caller's project, or null for a tick or a global window |
| `projects` | The projects where the plugin is enabled |
| `tagma` | The typed client, bound to `project`. `tagma.in(id)` reaches another enabled project. |
| `servers` | `servers.<name>.call(tool, input)` for the servers the plugin brought, under their sign-in |
| `data` | The plugin's data directory |
| `secrets` and `options` | Their values |
| `log` | Writes to stderr |
| `signal` | Aborts when the call is cancelled |
| `changed(uri)` | Tells the resource's subscribers it changed |

A handler fails by throwing. A thrown `Refusal(reason)` reaches the caller as its reason. Any other error reaches the caller as `isError` with its message, never as a protocol fault.

**Whether a plugin has a process** follows from the definition: it has one when a field carries a handler. A plugin made only of themes, views, shortcuts, skills and commands runs no process.

**Other languages.** Code in another language lives behind the definition, in an MCP server the plugin declares or in a program its handlers run.

## What the build emits

`tagma-plugin build` writes `dist/` and `tagma-plugin.json`:

1. **It reads the definition.** It imports `plugin.ts` in describe mode: `definePlugin` returns a description, and no handler runs.
2. **It writes the manifest:**
   - the envelope: `id`, `title`, `version` from `package.json`, and `engines.tagma`, the SDK surface version the plugin was built against;
   - `process: {entry: 'dist/process.js', resident?}`, when a handler exists;
   - `contributes` by point, each tool with its description, input JSON Schema and annotations. The catalog shows what the plugin brings before install, and agents see its tools before its process ever starts.
3. **It bundles the handlers** and their dependencies into one `dist/process.js`. Installing from npm, git or a marketplace therefore runs no `npm install` and no install script on the person's machine. The build refuses native `.node` addons and dynamic imports it cannot bundle. Tagma runs the file on its own runtime (`process.execPath`) with `--no-install`, so an import that slipped out of the bundle fails loudly instead of being fetched from npm.
4. **It bundles a provider part** into `dist/provider.js`, against the host modules the in-server loader serves.
5. **It prepares the views.**
   - Svelte views: it ships `.svelte` and `.svelte.ts` files as source, bundles every other import of theirs into plain ESM chunks, and rewrites the Svelte files' imports to those chunks.
   - Bundled views (`view.bundle('./ui/react/index.tsx')`): one ESM file each, with the framework inside.
   - Page views (`view.page('./ui/board/')`): the folder, copied as it is.
6. **It checks the result.** It checks the manifest against the point schemas of its surface version. A manifest the server would refuse fails the build, with the reason the server would give.

The scaffold commits `dist/` and `tagma-plugin.json`. A collaborator, or an install from git, then has everything with no build of their own.

**The edit loop.** `tagma-plugin dev` rebuilds on every change. A plugin installed from a folder is read in place. Its process revision is the hash of the manifest and `process.entry`, so a rebuild restarts it once. Its views recompile apart from the process. An agent runs the build after its edits; the `plugins` skill says so.

## The process at run time

`dist/process.js` starts the SDK's runtime with the definition. The runtime:
- serves MCP over stdio and exits when stdin closes;
- lists exactly the tools the manifest names;
- decodes `_meta["runlith/caller"]` into `ctx.caller`, and checks inputs;
- answers resources, and their subscriptions with `notifications/resources/updated`;
- maps ticks, endings, notification answers, build steps and hook calls onto their handlers;
- calls the servers the plugin brought through the host.

What the apps skill now teaches by hand becomes the runtime's code: stdout carries only the protocol, `StdioServerTransport` does not watch for the end of stdin, `readOnlyHint` and `isError` mean what they mean, and data is keyed by `projectId`.

The protocol between the runtime and the host is part of the promised surface:
- the caller's shape;
- the names under which tools are listed;
- the payloads of ticks, endings, notifications, build steps and hooks.

## The client

**In the process.** `ctx.tagma.op(id, input)` reaches every operation declared `external: true`, and nothing else. Its types come from those operations' input and answer schemas, in encoded form:
- it returns the operation's answer arms, discriminated by `status`;
- a refusal throws `TagmaRefused`, with `code`, `reason` and `unblock`;
- keyed acts such as `start_turn` take their `key` as a field.

Decoding is lenient, so adding to the surface never breaks a running plugin: an answer arm, a refusal code or an entry role the plugin's SDK does not know arrives as an open variant carrying its raw value. On top of the generated calls the SDK owns the streams, which are not plain operations: `threads.events(ids, {since})` is an async iterator over the child spec's projection, with resume. Typing `op` by operation id, rather than mapping operations to method names by hand, keeps the client from drifting from the catalog.

**In a view.** The view gets `tagma` from its mount's context. In a Svelte view it is `getContext`, which `@runlith/tagma/ui` wraps as `useTagma()`. In a bundled view it is the `tagma` argument of `mount`. A single shared module could not tell the plugins apart. The surface is listed once here:

| Call | What it does |
|---|---|
| `tagma.tools.<name>(input)` | Calls one of the plugin's own `view` tools, typed from `typeof plugin` (`import type plugin from '../plugin'`) |
| `tagma.resource(uri)` | A reactive value in a Svelte view; `subscribe(uri, onChange)` returns an unsubscribe function for bundled views |
| `tagma.storage` | The view's key-value storage |
| `tagma.threadEvents(ids)` | The reactive projection of threads, with `subscribe` for bundled views |
| `<Thread id>` in Svelte, `tagma.mountThread(element, id)` in a bundled view | The whole thread, drawn by the host |
| `tagma.speech` | Listening and speaking, as the speech bridge offers views now |
| `tagma.openLink(url)` | Opens a link, during a click |
| `tagma.open(...)` | Opens a thread or a section of Tagma |
| `tagma.servers.<name>.call(...)` | Calls a tool of a server the plugin brought |

`@runlith/tagma/ui` also exports the host's components and tokens. A view reaches only this surface, through the view host's declared methods (`BRIDGE_METHODS`). `<Thread>` is the operator's own thread interface, and acts as the operator: placing it hands the person their own composer, not the plugin.

## Where it lives in the code

- **`packages/tagma`** gains the doors `./plugin`, `./ui` and `./testing`, and the `tagma-plugin` bin. The kit (`packages/tagma/kit/build.ts`) emits their declarations, as it does now for `/rules` and `/adapter/*`. `/ui` is published as a type facade generated from the window's exports; its implementation is the host module the window serves.
- **Schemas reach the SDK through the kit, never as a copy.** The rules doors already publish types from a private package by expanding every reference where it stands (explanation ade3bab6). The same expansion carries into the published declarations:
  - every point's schema, from its owner's `contract/wire`;
  - the schemas of every `external` operation;
  - `McpCaller`.

  At kit build the kit also writes the JSON Schema of every point, for the build's check. The point's owner stays its only author (rule 144dfedc, explanation 7d2dc40e).
- **One plugin template** ships in `packages/tagma`. A provider is that plugin with a `providers` field, since size never changes what a plugin is. `packages/tagma/kit/create.ts` and its adapter template fold into it. Two doors reach it:
  - inside Tagma, the `plugins` operation `create_plugin {id, title}` writes it into `.tagma-plugins/<id>/`, with no npm and no network;
  - an agent outside Tagma, such as one working in a repository, runs `tagma-plugin init`.
- **`@runlith/tagma/testing`** runs a definition under Bun with no Tagma running. It calls a tool as a given caller, fires a tick, delivers an ending or a hook call, and reads the emitted manifest. It mirrors the adapter kit's `conformance`.

## Versions

- **The surface has its own version, `major.minor`.** It is independent of Tagma's release numbers: Tagma releases bump their last number and stand on `0.x`, which a caret range cannot serve.
- **What the surface covers.** The external operations, the point schemas, the host protocol, the host modules, the view surface and the slot faces.
- **How it moves.** A minor adds; a major removes or changes.
- **What a plugin declares.** `engines.tagma` names the surface version the plugin was built against. Tagma accepts a plugin when the major is the same and its own minor is equal or higher. Otherwise the plugin reads `refused`, with both versions.
- **Development servers** carry the surface version in their code, so a checkout server, whose release reads `0.1.0`, judges plugins the same way.
- **The release build checks the surface.** It checks that the previous release's surface declarations are assignable to the new ones. A change that fails this check needs a surface major.
- **The acceptance plugins** are type-checked against each new SDK and run against each new Tagma, as real consumers.

## Acceptance

- **Creating.** `create_plugin` writes a folder into `.tagma-plugins/<id>/`, and `tagma-plugin init` writes the same template elsewhere. The folder builds, type-checks and installs through one `install_plugin`.
- **The build.** `tagma-plugin build` emits `tagma-plugin.json` with each tool's JSON Schema. A field the server would refuse fails the build with the server's reason. An unbundlable import fails the build.
- **Inputs.** A zod-typed tool shows its JSON Schema to an agent before the process first starts. Invalid input answers `isError` with the validator's message, and the process stays up.
- **The client.** `ctx.tagma.op` offers exactly the `external` operations. A refusal throws with its `code`. An unknown answer arm decodes as an open variant.
- **The plugin's own server.** `ctx.servers.gitlab.call` reaches the server the plugin brought, under its sign-in.
- **Views.** A Svelte view calls its own `view` tool with the types of `typeof plugin`. Two plugins' views on one screen each reach only their own tools.
- **Installing.** A plugin installed from npm runs with no `npm install` on the machine.
- **Versions.** A plugin built against surface `1.2` runs on Tagma serving `1.3`, and on a checkout server serving `1.3`. One built against `2.0` reads `refused`, with both versions.
- **Testing.** `@runlith/tagma/testing` calls a tool as an agent caller and fires a tick under Bun, with no Tagma running.
- **SDK only.** Every acceptance plugin of [[d2b5f488]] and [[c4451a7e]] is written only against the SDK, with no raw HTTP or MCP.

## Not established

- Whether Effect 4's Schema implements Standard JSON Schema; zod, ArkType and Valibot are listed as implementers.
- Whether the kit's expansion, built for the types of the rules doors, carries the point and operation schemas of the server without changes.
