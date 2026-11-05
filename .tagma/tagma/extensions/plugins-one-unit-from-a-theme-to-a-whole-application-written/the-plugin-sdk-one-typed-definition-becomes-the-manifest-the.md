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
Child of [[d2b5f488]]. Read from the code at `11f23bfc7` on 2026-11-05; nothing was run.

## Outcome

Every plugin is written against `@runlith/tagma-sdk` and reaches Tagma only through it: the SDK is typed, public and the plugin's one import from Tagma. That holds for plugins a person writes, plugins an agent writes from a prompt, and the plugins in Tagma's marketplace.

The author writes one TypeScript definition. The SDK turns it into the manifest Tagma reads without running the plugin, the process that serves its tools, and the views drawn in the window. MCP, HTTP, grants and manifest fields stay below the SDK. An author never meets them, and an agent writing a plugin never has to learn them.

## What the author writes

One module, `plugin.ts`, exports one definition. Every field is optional except `id` and `title`.

```ts
import { definePlugin, tool, schedule, view, hook, deny } from '@runlith/tagma-sdk/plugin';
import { z } from 'zod';

export default definePlugin({
  id: 'gitlab',
  title: 'GitLab',
  secrets: { GITLAB_TOKEN: { title: 'Personal access token' } },
  tools: {
    list_mrs: tool({
      description: 'List open merge requests of a project',
      input: z.object({ project: z.string() }),
      audience: 'agents',
      readOnly: true,
      run: async ({ project }, ctx) => fetchMrs(project, ctx.secrets.GITLAB_TOKEN),
    }),
  },
  agents: { reviewer: { file: './agents/reviewer.md' } },
  views: { mrs: view('./ui/Mrs.svelte'), grid: view('./ui/Grid.svelte') },
  sections: [{ view: 'mrs', title: 'Merge requests', icon: './ui/icon.svg' }],
  windows: { grid: { view: 'grid', frame: false, onTop: true } },
  shortcuts: [{ keys: 'Mod+J', open: 'grid' }],
  schedules: { poll: schedule({ every: '1m', run: async (tick, ctx) => syncBoard(ctx) }) },
  hooks: [hook({ at: 'beforeTool', match: { tool: 'bash' }, run: async (call) => (risky(call) ? deny('…') : undefined) })],
});
```

**Fields.** Each field maps to a point its owner declares, as listed below. A field's type, and the check the build runs on it, come from that point's own schema. The SDK never redeclares them.

| Field | Point and owner |
|---|---|
| `tools` | `tools` (`plugin-host`) |
| `agents` | `native-harness` agents |
| `views`, `sections`, `panes`, `windows`, `results`, `pins`, `shortcuts` | `views`, `threads` and the shell |
| `schedules` | `schedule` |
| `notifications` | `notify` |
| `onThreadEnded` | `on` (`threads`) |
| `beforeBuild` | `checkout-builds` |
| `hooks` | the `plugin-hooks` rule (child spec [[c4451a7e]]) |
| `resources` | `plugin-host` |
| `secrets` | `secrets` |
| `themes` | the window's `Theme` |
| `providers` | `/adapter/provider` and the speech contract |

**Input schemas.** Tool and resource inputs take any validator that implements Standard Schema for checking and Standard JSON Schema for the JSON Schema an agent reads. Zod 4.2 and later, ArkType and Valibot implement both. `create-tagma` scaffolds with zod, the library authors and models know best. Input that fails validation answers the call as `isError` with the validator's message, and the process keeps running.

**Handlers.** Every `run` is a plain async function `(input, ctx)`. The public surface carries no Effect. The adapter contract under `providers` keeps Effect, because it runs inside the server. `ctx` holds:
- `caller` — the `McpCaller` the host passed (`packages/mcp/src/mcpCallerMeta.ts`): an agent with its thread and bindings, the operator through a view, or Tagma itself with a reason;
- `project` — the caller's project;
- `tagma` — the typed client below, bound to that project;
- `data` — the plugin's data directory;
- `secrets` — the values set for the declared secrets;
- `log`, which writes to stderr;
- `signal`, which aborts when the call is cancelled;
- `changed(uri)`, which tells subscribers that a resource changed.

A handler fails by throwing. A thrown `Refusal(reason)` reaches the caller as its reason. Any other error reaches the caller as `isError` with its message, never as a protocol fault.

**Whether a plugin has a process** follows from the definition: it has one if any field carries a handler. A plugin of themes, views and shortcuts runs no process.

**Other languages.** Code in another language lives behind the definition: either in an MCP server the plugin declares, which is a connection it brings, or in a program its handlers run. The plugin itself is always the SDK's.

## What the SDK emits

`tagma-sdk build` (the SDK's bin) produces `dist/` and `tagma-plugin.json`:
1. It imports `plugin.ts` in describe mode: `definePlugin` returns a description, and no handler runs.
2. It writes `tagma-plugin.json`:
   - the envelope: `id`, `title`, `version` from `package.json`, and `engines.tagma` from the SDK's own range;
   - `process: {entry: 'dist/process.js'}` when a handler exists;
   - `contributes` by point, each entry with its description, so the catalog shows what the plugin brings before install.
3. It bundles the handlers and their dependencies into one `dist/process.js`. Installing from npm, git or a marketplace therefore runs no `npm install` and no install script on the user's machine. Tagma runs that file on the JavaScript runtime it runs on itself.
4. It copies native views as `.svelte` source and their assets into `dist/ui/`, for Tagma to compile. It builds a foreign view (`view.bundle('./ui/react/index.tsx')`) into one ESM file with its framework inside.
5. It checks the manifest against the point schemas of the SDK's Tagma version. A manifest the server would refuse fails the build with the reason the server would give.

`tagma-sdk dev` rebuilds on every change. A plugin installed from a folder is read in place, as folder installs already are. Tagma's supervisor restarts its process on the change, and views are recompiled. The edit loop therefore is: edit, rebuild, see it. An agent runs the build after its edits; the `plugins` skill says so.

## The process at run time

The bundled `process.js` starts the SDK's runtime with the definition. The runtime:
- serves MCP over stdio, and exits when stdin closes;
- lists exactly the tools the manifest names, under their manifest names;
- decodes `_meta["runlith/caller"]` into `ctx.caller`;
- validates input;
- answers resources, and their subscriptions with `notifications/resources/updated`;
- maps a tick, an ending, a notification answer, a build step and a hook call onto their handlers;
- reads the grant from its environment and hands it to `ctx.tagma`.

What the apps skill now teaches by hand — stdout carrying only the protocol, the stdin end that `StdioServerTransport` does not watch, `readOnlyHint`, `isError`, keying data by `projectId` — becomes the runtime's code.

## The client

**In the process.** `ctx.tagma.op(id, input)` reaches every operation declared `external: true`, and nothing else. Its types come from that operation's input and answer schemas, in encoded form:
- the return value is the operation's answer arms, discriminated by `status`;
- a refusal throws `TagmaRefused` with `code` typed from the operation's declared `refusals`, plus `reason` and `unblock`;
- `start_turn` and every other keyed act take their `key` as a field.

The client calls `POST /api/op/<id>?project=` with the grant, as the child spec [[c4451a7e]] defines it. On top of these generated calls the SDK owns the streams, which are no plain operation: `threads.events(id, {since})` is an async iterator with resume and `reset`. Typing `op` by id, instead of hand-mapping operations to method names, keeps the client's names from drifting from the catalog.

**In a native view.** `@runlith/tagma-sdk/ui` exports:
- `tagma.tools.<name>(input)` for the plugin's own `view` tools, typed from the definition (`import type plugin from '../plugin'`);
- `tagma.resource(uri)` as a reactive value;
- `tagma.storage`;
- `tagma.thread(id)` as the reactive projection of the child spec;
- `tagma.open(...)`;
- `<Thread id>`;
- the host's components and tokens.

A view reaches only this surface, through the view host's methods, which are declared bridge methods today (`BRIDGE_METHODS`). It never reaches the window's operation catalog. A foreign view gets the same surface as the `tagma` argument of `mount(element, tagma)`.

## Where it lives in the code

- **`packages/tagma` becomes `@runlith/tagma-sdk`.** It adds the doors `./plugin`, `./ui`, `./testing` and the `tagma-sdk` bin, beside `./rules` and `./adapter/*`. The kit's build (`packages/tagma/kit/build.ts`) emits their declarations, as it does for the existing doors.
- **The server's schemas reach the SDK through the kit, never through a copy.** The rules doors already publish types from a private package by expanding each reference where it stands (explanation ade3bab6). The same expansion carries into the published declarations:
  - the point schemas, from each owner's contract;
  - the operation schemas of every `external` operation;
  - `McpCaller`.

  At kit build time the kit also writes the JSON Schema of every point, as `read_app_schema` builds it now, for the SDK's build check. A point's owner stays its only author (rule 144dfedc, explanation 7d2dc40e).
- **`create-tagma`** is its own package. It offers the plugin template and the provider template. `packages/tagma/kit/create.ts` and its adapter template move into it, so one generator serves both (rule dd380bf6).
- **`@runlith/tagma-sdk/testing`** runs a definition with no Tagma running. It calls a tool as a given caller, fires a tick, delivers an ending or a hook call, and reads the emitted manifest. It mirrors the adapter kit's `conformance`.

## Versions

- The SDK is cut from the core at each Tagma release and carries that version.
- `engines.tagma` reads `^<that version>` from the build.
- Within a major, the promised surface changes only by addition. Tagma keeps every operation, point field and host module it promised to a plugin built for that major.
- Removing or changing a promised piece is a new major. Tagma refuses a plugin whose `engines.tagma` excludes it, and shows the plugin as `refused` with the range.
- The contract is checked by the acceptance plugins: they are type-checked against each new SDK and run against each new Tagma. That is a real consumer, never a snapshot.

## Acceptance

- `npm create tagma` produces a folder that builds, type-checks and installs from the folder through one `install_plugin`.
- `tagma-sdk build` emits `tagma-plugin.json`. A field the server would refuse fails the build with the server's reason.
- A zod-typed tool shows its JSON Schema to the agent. Invalid input answers `isError` with the validator's message, and the process stays up.
- `ctx.tagma.op` offers exactly the `external` operations. A refusal throws with `code` typed from the operation's refusals.
- A native view calls its own `view` tool with types taken from `typeof plugin`.
- A plugin installed from npm runs with no `npm install` on the machine.
- A plugin built with SDK `x.y` runs on Tagma `x.(y+1)`. One whose `engines.tagma` excludes the running Tagma reads `refused` with the range.
- `@runlith/tagma-sdk/testing` calls a tool as an agent caller and fires a tick, with no Tagma running.
- Every acceptance plugin of [[d2b5f488]] and [[c4451a7e]] is written only against the SDK, with no raw HTTP or MCP.

## Not established

- Whether Effect 4's Schema implements Standard JSON Schema; zod, ArkType and Valibot are listed as implementers.
- How a release ships the JavaScript runtime that runs `process.js`.
- Whether the kit's expansion, built for the rules doors' types, carries the server's point and operation schemas without changes.
