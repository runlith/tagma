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
import { definePlugin, tool, schedule, view, hook } from '@runlith/tagma/plugin';
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
  views: { mrs: view('./ui/Mrs.svelte') },
  sections: [{ view: 'mrs', title: 'Merge requests', icon: './ui/icon.svg' }],
  shortcuts: [{ keys: 'Mod+Alt+G', action: 'section:mrs' }],
  schedules: { poll: schedule({ every: '1m', run: async (tick, ctx) => syncBoards(ctx) }) },
  hooks: { shell: hook({ at: 'beforeTool', match: 'bash', run: async (call) => (risky(call) ? { deny: '…' } : undefined) }) },
});
```

**Fields.** Each field maps to a point its owner declares. Its type, and the check the build runs on it, come from that point's schema in the owner's `contract/wire`; the SDK never redeclares one.

| Field | Owner |
|---|---|
| `tools`, `resources`, `resident` | `plugin-host` |
| `skills`, `options` | `plugins` |
| `mcpServers` | `mcp`, through its port for contributors |
| `agents` | `native-harness` |
| `secrets` | `secrets` |
| `views`, `sections`, `panes`, `windows`, `launchers`, `results`, `pins`, `shortcuts`, `actions`, `commands` (prompt commands) | `views` |
| `themes` | `appearance` ([[ca575591]]) |
| `schedules` | `schedule` |
| `notifications` | `notify` |
| `onThreadEnded`, `onThreadAsked`, `threads` (`listed`) | `threads` |
| `beforeBuild` | `checkout-builds` |
| `hooks` | `plugins`; the `plugin-hooks` rule runs them ([[c4451a7e]]) |
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

`tagma-plugin build` writes `dist/` and `tagma-plugin.json`, and type-checks the plugin first. A `.svelte` file is checked through svelte2tsx, and `svelte` and `@runlith/tagma/ui` resolve from the SDK itself, whatever the plugin's folder holds: the types a view is checked against are the SDK's own Svelte and its `/ui` facade. A misuse fails with the file and place in the `.svelte` source (`ui/Board.svelte(12,8)`). A file Svelte cannot parse stops the build at the views step, not here.

1. **It reads the definition** in describe mode: it imports `plugin.ts`, `definePlugin` returns a description, and no handler runs.
2. **It writes the manifest:**
   - the envelope: `id`, `title`, and `version` from `package.json`;
   - `process: {entry: 'dist/process.js', resident?}`, when a handler exists;
   - `contributes` by point, each tool with its description, input JSON Schema and annotations;
   - a hash of the sources the build read.

   The catalog shows what the plugin brings before install, and agents see its tools before its process ever starts.
3. **It bundles the handlers** and their dependencies into one `dist/process.js`, so installing from npm, git or a marketplace runs no `npm install` on the person's machine.
   - The build refuses native `.node` addons, and dynamic imports it cannot bundle.
   - Tagma runs the file on its own runtime (`process.execPath`) with `--no-install`. An import that slipped out of the bundle then fails loudly instead of being fetched.
4. **It bundles a provider part** into `dist/provider.js`, against the host modules the in-server loader serves.
5. **It prepares the views** as the view graph `dist/ui/` ([[96ba6027]]).
   - **Files.** Every file the views reach is shipped as written: the plugin's own under their paths, each dependency's under `_modules/<package>/`. Host specifiers (`svelte`, `svelte/*`, `@runlith/tagma/ui`) stay bare.
   - **`graph.json`.** Every import each file writes, with the file it resolved to, and the Tailwind class candidates of the shipped files.
   - **Proof.** It bundles the graph as Tagma will, with its own Svelte, so a view the compiler rejects fails the build with the compiler's message. The bundle is discarded.
   - **Refusal.** A dependency that ships another compiler's output, a `.js` file importing `svelte/internal/*`, fails the build.
6. **It checks the result** against the point schemas of the SDK's own Tagma version. A manifest the server would refuse fails the build, with the reason the server would give.

The template commits `dist/` and `tagma-plugin.json`, and marks them as generated and merged as binary in `.gitattributes`. A collaborator, or an install from git, then has everything with no build of their own.

**The edit loop.** `tagma-plugin dev` rebuilds on every change. A plugin installed from a folder is read in place. A rebuild that changes only views republishes them without restarting the process, and Tagma recompiles only the files that changed. An agent runs the build after its edits; the `plugins` skill says so.

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

The protocol between the runtime and the host belongs to the SDK: the shape of the caller, the names under which tools are listed, and the payloads of ticks, endings, questions, notifications, build steps, hooks and actions. So does the runtime baseline a process may rely on:
- the Bun version range of the Tagma release;
- the Node built-ins Bun implements;
- `bun:sqlite`, for a plugin that keeps its own database.

## The client

**In the process.** `ctx.tagma.op(id, input)` reaches every operation declared `external: true`, and nothing else. Its types come from those operations' input and answer schemas, in encoded form:
- it returns the operation's answer arms, discriminated by `status`;
- a refusal throws `TagmaRefused`, with `code`, `reason` and `unblock`;
- keyed acts such as `start_turn` take their `key` as a field.

On top of the generated calls the SDK owns one call that is not a plain operation: `models.ask(prompt, {model, schema})`. It turns a Standard Schema into the JSON Schema `ask_model` takes, and parses the answer with it, so the value comes typed. A process receives threads' run ends and questions as deliveries to its handlers, never as a stream ([[c4451a7e]]).

Typing `op` by operation id, rather than mapping operations to method names by hand, keeps the client from drifting from the catalog.

**In a view.** A Svelte view gets `tagma` from its mount's context, through `getContext`, which `@runlith/tagma/ui` wraps as `useTagma()`. A single shared module could not tell the plugins apart. This is the surface:

| Call | What it does |
|---|---|
| `tagma.tools.<name>(input)` | Calls one of the plugin's own `view` tools, typed from `typeof plugin` (`import type plugin from '../plugin'`) |
| `tagma.resource(uri)` | A reactive value |
| `tagma.storage` | The view's key-value storage |
| `tagma.thread(id)` | What a thread does now — its run, open question, streaming line and outcome — as a reactive value |
| `tagma.transcript(id)` | One thread's transcript, with its tool calls in flight, as a reactive value paged back on demand ([[c4451a7e]]) |
| `<Thread id>` | The whole thread, drawn by the host |
| `tagma.speech` | Listening and speaking, as the speech bridge offers views now |
| `tagma.openLink(url)` | Opens a link, during a click |
| `tagma.open(...)` | Opens a thread or a section of Tagma |
| `tagma.servers.<name>.call(...)` | Calls a tool of a server the plugin brought |
| `tagma.theme` | The theme in force, `{id, mode}`, as a reactive value, for a view that draws on a canvas ([[ca575591]]) |

`@runlith/tagma/ui` also exports the host's components and tokens, and `<Frame src>`, which embeds someone else's site, widget or web application in an iframe on its own origin. A view is written against this surface only. It runs in the window's own document, so the surface is its contract, not a wall ([[d2b5f488]], Risks). `<Thread>` is the person's own thread interface and acts as the person: placing it hands the person their own composer, not the plugin.

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

While rule [[0528876d]] stands, the SDK keeps no compatibility and no version gate:
- The SDK carries Tagma's release and changes with it in the same commit.
- A plugin either fits the running Tagma or reads broken. **Fix with an agent** then rebuilds it on the running SDK.
- The acceptance plugins are type-checked against each new SDK and run against each new Tagma, so a change that breaks them is fixed in the same work.

Surface versions, `engines.tagma`, lenient decoding and a release-time compatibility check come when the rule is cancelled and outside authors arrive.

## Acceptance

- **Creating.** `create_plugin` writes a folder into `.tagma-plugins/<id>/`, and `tagma-plugin init` writes the same template elsewhere. After the agent installs dependencies, the folder builds, type-checks, and installs through one `install_plugin`.
- **The build.** `tagma-plugin build` emits `tagma-plugin.json` with each tool's JSON Schema and the source hash. A field the server would refuse fails the build with the server's reason. An unbundlable import fails it, and so does a dependency reaching `svelte/internal/*`.
- **Inputs.** A zod-typed tool shows its JSON Schema to an agent before the process first starts. Invalid input answers `isError` with the validator's message, and the process stays up.
- **The client.** `ctx.tagma.op` offers exactly the `external` operations. A refusal throws with its `code`.
- **The plugin's own server.** `ctx.servers.gitlab.call` reaches the server the plugin brought, under its sign-in.
- **Views.**
  - A Svelte view calls its own `view` tool with the types of `typeof plugin`.
  - Two plugins' views on one screen each reach only their own tools.
  - A view that uses a Svelte component library from npm compiles against the window's runtime.
- **Installing.** A plugin installed from npm runs with no `npm install` on the machine.
- **Breaking.** A plugin the running Tagma no longer accepts reads broken. Fix with an agent rebuilds it on the running SDK, and it runs again.
- **Testing.** `@runlith/tagma/testing` calls a tool as an agent caller, fires a tick and delivers a question under Bun, with no Tagma running.
- **SDK only.** Every acceptance plugin of [[d2b5f488]] and [[c4451a7e]] is written only against the SDK, with no raw HTTP or MCP.

## Not established

- Whether Effect 4's Schema implements Standard JSON Schema; zod, ArkType and Valibot are listed as implementers.
- Whether the kit's expansion, built for the rules doors' types, carries the server's point and operation schemas without changes.
