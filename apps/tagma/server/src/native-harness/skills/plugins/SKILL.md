---
name: plugins
description: Build, change, install or debug a plugin in Tagma's format — a folder whose `plugin.ts` is written against `@runlith/tagma/plugin` and built by `tagma-plugin build` into `tagma-plugin.json` and `dist/process.js`, adding tools, views, sections, panes, launchers, agents, schedules, notifications, thread endings, build steps and themes inside Tagma with no deploy. Load before writing or editing anything in a project's `.tagma-plugins/<id>/`; when the operator asks for a plugin, a bridge to a service, a board, a game, a section inside Tagma or a new look for Tagma; when read_plugins shows such a plugin refused, outdated or its process failed, or a plugin view does not open. Installing a Claude Code or Codex plugin needs only install_plugin; connecting an existing MCP server is add_mcp_server.
---

# Plugins

A plugin in Tagma's format is a folder whose `plugin.ts` exports one definition written against `@runlith/tagma/plugin`. `tagma-plugin build` turns it into `tagma-plugin.json`, which Tagma reads without running anything, and `dist/process.js`, the process serving its handlers. Both are build output: never edit them by hand, and commit them with the sources.

## Making and changing one

1. `create_plugin {id, title}` writes a new folder into the project's `.tagma-plugins/<id>/` and answers its `path`; a folder already there refuses `plugin-folder-taken`. Outside Tagma, `bunx --package @runlith/tagma tagma-plugin init <folder> --id <id> --title <title>` writes the same files. `id`: lowercase letters, digits and inner hyphens, at most 40.
2. Install its dependencies in the folder with the project's package manager (`bun install`). With none on the machine, install Bun first: `curl -fsSL https://bun.sh/install | bash` on macOS and Linux, `powershell -c "irm bun.sh/install.ps1 | iex"` on Windows. Add libraries the same way: the build bundles them, so nothing is installed where the plugin runs.
3. Write the definition. After every edit run `bunx tagma-plugin build` in the folder: it type-checks, refuses a field `definePlugin` does not take, runs the checks Tagma runs at install, each point alone and against the points it names, and stops with Tagma's reason. `bunx tagma-plugin dev` rebuilds on every change for as long as it runs.
4. `bun test` runs the folder's tests (Testing).
5. `install_plugin {source: ".tagma-plugins/<id>"}` installs it once, read in place, and runs it in this project; `scope: "user"` runs it in every project, `enabled: false` only installs it. `enable_plugin {id, enabled, scope?}` runs or stops it; `uninstall_plugin` stops it everywhere and keeps its data. Each rebuild reaches the installed plugin by itself.
6. Commit the folder with `dist/` and `tagma-plugin.json`, without `node_modules`: whoever opens the project runs it with no build.

## The definition

```ts
import { definePlugin, tool } from '@runlith/tagma/plugin';
import { z } from 'zod';

export default definePlugin({
  id: 'notes',
  title: 'Notes',
  tools: {
    add_note: tool({
      description: 'Add a note to the board of this project.',
      audience: 'agents',
      input: z.object({ text: z.string().min(1).describe('The note') }),
      run: async ({ text }, ctx) => `Added ${text} in project ${ctx.project}.`,
    }),
  },
});
```

The `example` reference is a whole plugin with a tool, a resource and a section. Only `id` and `title` are required; everything a field accepts is in its type.

- **`tools: {<name>: tool({...})}`.** The name uses letters, digits, `_` and `-` and never starts with `__`. `audience`: `agents` — every agent with the `plugins` capability in a project where the plugin is enabled, deferred, as `plugin__<id>__<name>` (at most 64 characters); `own` — only the plugin's own agents; `view` — only its views. `input` takes a schema implementing Standard Schema and Standard JSON Schema (zod 4.2 or later, ArkType, Valibot): agents read its JSON Schema, and input failing it answers an error with the validator's message; a tool without `input` takes no arguments. `readOnly: true` marks a tool that changes nothing, which runs without asking in review mode; `destructive: true` makes the review question a destructive one; `idempotent`, `openWorld` and `title` complete the annotations. `run(input, ctx)` returns a string, which is the answer, a JSON value, which also becomes its structured content, or nothing.
- **Failing.** Throw `new Refusal(reason)`: the caller reads the reason. Any other thrown error answers with its message. Neither stops the process.
- **`resources: {<name>: resource({uri, read})}`** feed views. `uri` may hold placeholders, `notes://project/{project}`, handed to `read(params, ctx)`; `mimeType` defaults to text for a string and JSON otherwise. A view subscribes, and `ctx.changed(uri)` tells its subscribers to read again. A subscription is admitted only where a `read` by the same caller succeeds, so refuse in `read` a caller from another project.
- **`schedules: {<name>: schedule({every, run})}`.** `every` is milliseconds, at least 1000, or `'30s'`, `'5m'`, `'1h'`, `'1d'`. `run(tick, ctx)` gets `{name, scheduledAt, startedAt, skipped}` on a grid of `every`; `skipped` counts the grid points already passed when the run started, so after sleep or downtime one run stands for them. One run goes at a time, and the next is the first grid point after it ends. A failure is recorded as that run's outcome, not retried off the grid. A run cut by a server stop runs again after start: make its effects idempotent by `name` and `scheduledAt`. Ticks belong to the machine: a plugin running in no project has none. `read_schedules` shows each under owner `plugin:<id>`.
- **`beforeBuild: {<name>: beforeBuild({title, run})}`** runs when an update from a checkout (Latest commit, Working tree, `tagma update`) builds the checkout of a project where the plugin is enabled, before the source is cut. `run({offer, checkout}, ctx)` returns `{verdict: 'go'}`, `{verdict: 'pending'}` (asked again a second later, with no deadline) or `{verdict: 'stop', reason, thread?}`, which ends the update unbuilt and shows the reason, with Open thread when it names a thread of that project. A failure stops the update too. A commit the step lands is the one built. The card shows `title` while the step runs.
- **`actions: {<id>: action({title, run})}`** are what the person runs from the palette or a shortcut. `<id>` follows the view id rule (lowercase letters, digits, inner hyphens, at most 40), `title` is 1–60 characters. `run(ctx)` runs for the operator in the project where the key was pressed (`ctx.project`), starts the process if it sleeps, and may return one sentence, which the window shows as a notice; a thrown error, a `Refusal` included, shows as a refusal notice. An action is not a tool: agents never see it.
- **`shortcuts: [{keys, action, global?}]`** propose chords. `keys` joins modifiers and one key with `+`, like `Mod+Alt+G` (`Mod` is ⌘ on macOS and Ctrl elsewhere; `Cmd`, `Ctrl`, `Alt`, `Shift`; keys `A`–`Z`, `0`–`9`, `F1`–`F24` and names such as `Enter`, `Space`, `Comma`, `BracketLeft`); a chord needs `Mod`, `Cmd`, `Ctrl` or `Alt`, or is a function key. `action` is an id of `actions`, `section:<view>` for a view in `surfaces`, or `pane:<view>` for one in `panes`; anything else, or a chord listed twice, fails the build and the install with that reason. A chord is a proposal, not a claim: Tagma's own keys and the person's win it, among plugins the one installed earlier keeps a contested chord, and a displaced chord stays unbound while the plugin's card says what holds it and offers Rebind. `global: true` asks for the chord to work in every app: the person allows it with one click on the plugin's card, and until then it works inside Tagma only.
- **`onThreadEnded: onThreadEnded(async (ending, ctx) => …)`** gets `{threadId, runId, status, failureReason}` after every turn of a thread whose `bindings.plugin` names the plugin; keep-warm and compaction runs do not count. A failure, or the plugin not running then, delivers it again later until its attempts run out, when `read_endings` shows `notification-exhausted`: take it idempotently by `runId`.
- **`onThreadAsked: onThreadAsked(async (asked, ctx) => …)`** takes the questions of the plugin's threads while it runs in their project: `{threadId, questionId, summary, prompts, deadlineAt}`, `prompts` each `{id, prompt, header?, options, freeform, multiple}` or null for a confirmation. Such a question leaves the person's attention; answer it with `answer_question {threadId, questionId, answers: [{questionId: <prompt id>, values}]}`, at once or later, before `deadlineAt`. Return `leave()` to hand it to the person for good; a thrown error does the same. While the plugin is switched off or its process has failed, its questions stand with the person, and they arrive again once it runs, and after a server restart: take them idempotently by `questionId`. A question with a secret prompt always goes to the person.
- **`onNotification: onNotification(async (answer, ctx) => …)`** lets the process send notifications, and gets the operator's answer or dismissal as `{id, title, kind, answer, at}` (`kind` `answered` or `dismissed`), handed again until it succeeds: take it idempotently by `id`.
- **`options: [{key, title, description, type?, sensitive?, required?, default?}]`.** `key` names the value: capitals, digits and `_`, at most 64, not starting with `TAGMA_` and none of `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `TMPDIR`. `type`: `string` (the default), `number`, `boolean`, `directory`, `file`. `default` stands while no value is set. `sensitive: true` keeps the value in the key store and masks it in everything the process answers. Read values from `ctx.options[key]`. The operator sets them on the plugin's card in Plugins, a secret one once the plugin runs in that project: tell them which to set, never ask for a value in chat, and answer what is missing while a required one is unset.
- **`resident: true`** keeps the process running while the plugin is enabled, for one that holds a live connection to a service.
- **`views: [{id, entry, live?, csp?}]`** — `id` lowercase letters, digits and inner hyphens, at most 40; `entry` an HTML page under `ui/`, as `ui/board.html` (Views). A view shows only where another field places it. `live: true` keeps a result view running while scrolled away, within the feed's budget. `csp` opens outside origins as MCP Apps does: `frameDomains` for embedded players, `resourceDomains` for images, media, fonts, scripts and styles, `connectDomains` for fetch and sockets, `baseUriDomains`; an entry naming this machine or a bare address is dropped.
- **`results: [{tool, view}]`** draws the feed entry of a call to an `agents` or `own` tool with the view. **`surfaces: [{view, title, icon?}]`** — a project section at `/<project>/p/<id>/<view>` with a rail item and a palette action, `title` at most 40, `icon` an svg, png, webp, gif or jpg under `ui/`. **`panes`** — a side pane, the same shape. **`launchers: [{view, title}]`** — a palette action and a rail button opening the view in a window, `title` at most 60. **`pins: [{view}]`** — views a thread may pin above its feed. **`agents: [{id, path}]`** — Agents of a plugin.
- **`themes: {<id>: {title, light?, dark?}}`** — how Tagma looks, as data with no process; the `themes` reference carries the colour groups, the check that keeps state colours in their meaning, and choosing it.

A field that fails when the plugin starts — a view missing from `views`, a result for a tool that is not `agents` or `own`, an agent file that does not parse — fails its process with the reason naming it.

## The handler's ctx

- `caller` — `{kind: 'agent', projectId, agentId, ownerId, thread: {threadId, runId, bindings} | null}` for an agent calling a tool; `{kind: 'operator', projectId, view, threadId?}` for a view acting for the operator, and for an action the operator runs (`view` is `action:<id>`); `{kind: 'tagma', projectId, reason}` for Tagma itself, `reason` `schedule`, `notification`, `ended`, `asked` or `build`, `projectId` null for the first two. It is attribution, not authentication.
- `project` — the caller's project, or null; `projects` — the projects where the plugin is enabled now. One process serves every project: key data and resource URIs by project and refuse a caller whose project is another.
- `tagma.op(operation, input)` calls Tagma in `project`; `tagma.in(projectId).op(…)` in another. It answers the operation's result, its `status` naming the arm; a refusal throws `TagmaRefused` with `code`, `reason` and `unblock`. A call in a project where the plugin does not run refuses `plugin-not-enabled`. Open to a plugin — the types offer nothing else:
  - `create_thread`, `start_turn`, `queue_turn`, `read_statuses`, `read_endings`, `read_thread` — threads of its projects;
  - `stop_run`, `answer_question`, `set_thread_model`, `continue_thread`, `restart_thread`, `archive_thread` — only the threads it owns, else `plugin-thread-mismatch`;
  - `pin_view`, `unpin_view` — `{threadId, plugin, view, key}` for a view in `pins`; the same address keeps one pin, and a pin outlives stopping the plugin;
  - `delete_worktree` — a worktree its thread stood in, once that thread rests (`create_thread` with `worktree: "new"` answers it as `snapshot.thread.place.rootId`); uncommitted work is committed onto the branch first;
  - `send_notification {title, body?, question?, key?}` — with `onNotification` defined, else `sender-required`. `question: {text, options}` asks, with up to 4 options or `[]` for a free answer; the same `key` answers the first notification with `repeated: true`; at most 20 stand open per plugin;
  - `read_model_menu` — the models the person's providers offer for text, by provider, each with its reasoning rungs, whether it is operator-only (`lowered`: the rung each operator-only rung lowers to) and its `switches` (id, values, default), the values `set_thread_model` takes; a model is named by provider and id;
  - `ask_model {prompt, system?, model?, schema?}` — one question to a model with no thread, on the person's accounts; use `ctx.models.ask` below;
  - the built-in browser's page, profile and cookie operations.
- `models.ask(prompt, {system?, model?, schema?})` asks a model once and answers its text. With `schema`, any Standard Schema (zod, ArkType, Valibot), it sends the schema's JSON Schema and parses the answer with the schema, so the value is typed; an answer off the shape throws. The model is the person's choice in the `ask.model` setting, or the `model: {provider, model, reasoning?}` you name, which answers or refuses `ask-unanswerable` and is never swapped for another. The ask is recorded as the plugin's, and the plugin's card shows what its asks spent over the period `activity.keepHours` keeps.
- `data` — a directory for the caller's project (`machine` for a call without one) that outlives restarts and uninstalling; `dataOf(projectId)` for another.
- `options`, `log(...)` (to stderr), `signal` (aborted when the call is cancelled), `changed(uri)`.

## Threads a plugin drives

- `create_thread` opens a thread without a turn: a root with `title`, `type` (an agent id; `<plugin>.<agent>` for its own), `bindings`, `approvalMode` and `account`, or a child with `parent` and `task`. `bindings` is a string map kept on the thread and handed back as `caller.thread.bindings` in every call its agent makes: put the plugin's own keys there to know which thread is calling.
- A thread the plugin creates is its own: Tagma writes `bindings.plugin` from the caller, and a `plugin` key in `bindings` refuses `binding-reserved`. Its turn endings reach `onThreadEnded` and its questions `onThreadAsked`. The plugin may stop, continue or restart it, move it to another model with `set_thread_model` (models from `read_model_menu`), and `archive_thread` it with its subtree or bring it back with `archived: false`. Children its agent spawns are ordinary children.
- **`threads: {listed?}`** says where such threads stand. By default, while the plugin runs in their project, they are left out of the general thread list and stand in the plugin's own places, its card lists them; `listed: true` lists them in the general list as well. A plugin switched off or removed leaves its threads in the general list like any other. `list_threads {plugin: "<id>"}` selects a plugin's threads by their binding, whatever it lists, and `ids` always selects exactly the threads named.
- `start_turn {threadId, text, key}` opens a run or joins the one going; the same `key` and text answer the same run with `acted: false`, other text under it refuses `key-reused`. `queue_turn` queues the message behind the running run. Words a plugin sends, into its own thread or the person's, reach the agent and the feed as a message from the plugin's title, never as the person's.

## Agents of a plugin

`agents` ships `{id, path}`: `path` a Markdown definition in the folder, in the format the `agent-definitions` skill describes. A plugin agent is offered as `<plugin>.<agent>` only where the plugin is enabled, to the operator and to external callers such as its process, not to other agents unless `agent.offered` opens it. It must list `capabilities` (`[]` for none of the standard tools); `plugin:<id>` is added and carries the `own` tools, named `plugin__<id>__<tool>` in a `tools` allowlist. Its threads are born in `trust` unless the creator names a mode. An error in any agent file fails the whole field.

## The process

- A definition with any tool, resource, schedule, action, build step or handler has a process; one with only views, places and agents has none.
- Tagma runs `dist/process.js` on its own runtime with no install, from the folder, as the operator; a `.env` is not loaded. Its environment is the options that have a value and Tagma's own variables, which the SDK reads for you. The build refuses native addons and imports of computed names, since neither could load there.
- Its contributions stand while the plugin is enabled, before any process ran: agents see its tools from the manifest. The first call, tick, ending, notification, build step or view subscription starts the process; after a quiet period with no call in flight and no open subscription (five minutes by default) it stops and reads `idle`. A crash also leaves it `idle`, and the next demand waits out a backoff of 1 to 60 s. A rebuild restarts a running process once and an idle one takes it at its next start; files under `ui/` load anew in the view without a restart.
- The SDK owns stdout for the protocol from the first byte: `console.log` and writes to `process.stdout`, those of modules loading included, go to stderr. The process exits when Tagma closes its input.

## Views

A view is an HTML page under `ui/` on the plugin's own origin — `http://<id>.localhost:<port>` on the server's machine, the plugin's own HTTPS port through Tailscale from another device — so it loads its scripts, styles and images by relative URL. Its CSP reaches only the plugin; `csp` opens outside origins. A browser that does not resolve `*.localhost` (some Safari versions) shows no views and says so.

The page speaks JSON-RPC 2.0 with its host over `window.parent.postMessage` — the MCP Apps protocol, version `2026-01-26` — and takes only messages whose `event.source` is `window.parent`:

1. Request `ui/initialize` with `{protocolVersion, appInfo, appCapabilities}`. The answer's `hostContext` carries `tagma: {projectId, plugin, view, threadId?, key?}` (`threadId` in a thread's feed or pin, `key` in a pin), `theme` (`light` or `dark`), `styles.variables` (the MCP Apps CSS variables, `--color-background-primary` and the rest, valued from Tagma's theme), `containerDimensions`, `locale` and `timeZone`.
2. Post the notification `ui/notifications/initialized`; the host notifies nothing before it.
3. Post `ui/notifications/size-changed {height}` whenever the page's height changes. A frame in the feed is capped at a share of the window; sections and panes fill their space.

Requests the view sends — at most 64 in flight; any other method answers `-32601`:
- `tools/call {name, arguments}` — a `view` tool of its plugin, else `plugin-tool-unoffered`; the handler sees caller `operator`. The answer is the MCP result: `content`, `structuredContent`, `isError`.
- `resources/read {uri}`; `resources/subscribe {uri}`, `resources/unsubscribe {uri}` — updates arrive as `notifications/resources/updated {uri}`, and a subscription survives restarts of the process.
- `ui/open-link {url}` — an `http` or `https` link, only during a click inside the view.
<!-- bridge-methods -->

The methods above are the ones this installation serves; a method outside the list answers `-32601`. A notification arrives as a JSON-RPC notification of that name. A `Reference:` names a section of this skill: ask for it in `references` of `load_skill`.

Messages the host sends:
- `ui/notifications/host-context-changed` with a new `theme`, `styles` or `containerDimensions`;
- `ui/resource-teardown`, a request: answer it with `{}` within a second, then the frame goes;
- in a result view, `ui/notifications/tool-input {arguments}`, then `ui/notifications/tool-result` with the stored MCP result, or `ui/notifications/tool-cancelled {reason}`. The feed may draw the view days after the call: draw from these, not from a fresh call.

Views mount only in a project where the plugin is enabled; elsewhere a result shows as an ordinary tool card.

## Testing

`testPlugin(plugin, {options?, projects?, tagma?})` from `@runlith/tagma/testing` runs the definition under Bun with no Tagma, through the same handlers the process serves:
- `call(tool, input, caller?)`, `tick(schedule, {scheduledAt?, startedAt?, skipped?}?)`, `end(ending, projectId?)`, `notify(answer)`, `build(step, {offer, checkout}, projectId?)`, `act(action, projectId?)` and `read(uri, caller?)` each answer `{text, isError, structured?}`;
- the default caller is an agent in project 1;
- `tagma` is a double `(operation, input, projectId) => Promise<answer>` that throws `TagmaRefused` to refuse;
- `manifest` is what the build writes, without `version` and `build`; `changed` lists the URIs `ctx.changed` reported.

## Checking it in Tagma

1. `read_plugins` until the row shows the process `idle` or `running`; `refused` or `failure` names the cause.
2. An `agents` tool reaches your own thread too, deferred: reveal `plugin__<id>__<tool>` with tool_search and call it. A `view` tool is reached only from its view.
3. Open each view where it lives — the section, the pane, the result in a thread — and check it draws and acts.

## When it does not work

- The build stopped — `types`, `definition`, `bundle` or `check` names the step, and the reason follows; fix the source and build again.
- `refused` on the row — `tagma-plugin.json` is missing or this Tagma does not accept it: build again with the SDK the folder installs.
- `outdated: true` on the row — the sources moved past the last build: build again.
- `process.state: failed`, its tools offered to no agent until a rebuild or a clean start — `process.failure` names a field that did not register; a listing that differs from the manifest, so the process was built from other sources: build again; or why it would not start, ending with its stderr.
- A tool missing from an agent's catalog — the plugin is not enabled in that project, the tool's audience is not `agents`, or the agent lacks the `plugins` capability.
- A blank view — it never posted `ui/notifications/initialized`, it listens to a source other than `window.parent`, or its CSP blocks what it loads; the browser console names the last.
