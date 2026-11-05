---
name: plugins
description: Build, change, install or debug a plugin in Tagma's format — a directory with a hand-written `tagma-plugin.json` whose optional process serves tools over stdio MCP and whose contributions add views, sections, panes, windows, agents, thread endings, schedules, notifications and build steps inside Tagma, with no deploy. Load before writing or editing anything in a project's `.tagma-plugins/<id>/`; when the operator asks for a plugin, a bridge to a service, a board, a game or a section inside Tagma; when read_plugins shows such a plugin refused or its process failed, or a plugin view does not open. Installing a Claude Code or Codex plugin needs only install_plugin; connecting an existing MCP server is add_mcp_server.
---

# Plugins

A plugin in Tagma's format is a directory holding `tagma-plugin.json`: its id and title, the options it asks for, an optional process — any program serving MCP over stdio — and its contributions by point: tools for agents, views drawn in the window, agents, thread endings, schedules, notifications, build steps. One process serves the whole machine while any project enables the plugin; a project sees its contributions only while the plugin runs there.

## Where it lives and how it runs

- **Directory.** Build one for the operator in the project's `.tagma-plugins/<id>/` and commit it without `node_modules`. Its `id` names its tools, agents, caller and view origin.
- **Install, enable, uninstall.** `install_plugin {source: ".tagma-plugins/<id>"}` records the folder on the machine, read in place (a relative path is read from the project root), and runs the plugin in this project; `scope: "user"` runs it in every project, `enabled: false` only installs it; in review mode it asks the operator, naming the command the process runs. `enable_plugin {id, enabled, scope?}` runs or stops an installed plugin in this project or in every project. `uninstall_plugin` stops it everywhere, ends its process and drops its secret values; the folder and the plugin's data stay. A manifest that does not decode, or a `contributes` entry its point does not accept, refuses `plugin-refused` with the reason.
- **State.** `read_plugins` answers the row: `root`, `format: "tagma"`, `enabled` here, `options` each with `set`, `refused` — why the directory as it stands cannot be read — and `process`: `state` (`stopped`, `starting`, `running`, `failed`), the `tools` it serves, `restarts`, `failure` — a point that did not register, or why the process would not start or exited, ending with its stderr — and `refused` — why the edited directory cannot run, while the running process keeps the declaration it started with.
- **Restarts.** A change to its files or to an option restarts the process, except files under top-level `ui/`, `node_modules` and `.git` at any depth, and what the plugin's own `.gitignore` names; an edited view shows on its next load. Calls arriving during a restart wait for the new process; calls in flight get 10 s to finish. A process that exits loses its contributions and returns after a backoff from 1 to 60 s, reset once it lived 30 s; a call during the backoff refuses at once. A point that failed to register waits for the next change to the plugin's files.
- **Environment.** The process runs as the operator in its plugin directory, with `TAGMA_SERVER_URL`, `TAGMA_CALLER` (`plugin:<id>`), `TAGMA_PLUGIN_DATA`, `TAGMA_PLUGIN_REVISION` (a hash of its code files' paths, sizes and modification times, not their content) and every option that has a value, under its key. Keep state in `TAGMA_PLUGIN_DATA` — `agent-plugin-data/<id>/` in the server's data directory, made before start — which outlives restarts and uninstalling. A file the process writes inside its own directory restarts it unless `.gitignore` names it.

## tagma-plugin.json

An unknown key at any depth refuses. Only `id` and `title` are required.

```json
{
  "id": "notes",
  "title": "Notes",
  "version": "1.0.0",
  "description": "A notes board per project.",
  "process": { "command": "bun", "args": ["server/main.ts"] },
  "options": [{ "key": "NOTES_TOKEN", "title": "Token", "description": "The service token.", "sensitive": true, "required": true }],
  "contributes": { "tools": [{ "name": "add_note", "audience": "agents" }] }
}
```

- `id`: lowercase letters, digits and inner hyphens, at most 40. `process.command` runs from the plugin directory.
- **Options.** `key` is the environment variable the value arrives in: capitals, digits and `_`, at most 64, not starting with `TAGMA_` and none of `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `TMPDIR`. `type`: `string` (the default), `number`, `boolean`, `directory`, `file`. `default`, a string, stands while no value is set. `sensitive: true` keeps the value in the key store and masks it in everything the process answers over MCP, not in what the process sends over HTTP.
- The operator sets options on the plugin's card in Plugins, a secret one once the plugin runs in that project: tell them which to set, and never ask for a value in chat, where it would stand in the feed. Keep a process lacking a required value up, answering what is missing.

### Points

`contributes` maps a point to its entries. `views` and the points placing them need no process; `tools`, `on`, `schedule`, `notify` and `beforeBuild` name tools the process serves.

- `tools: [{name, audience}]` — `agents`: every agent with the `plugins` capability in a project where the plugin is enabled, deferred, as `plugin__<id>__<tool>`, at most 64 characters; `own`: only the plugin's own agents; `view`: only its views, and no model sees it. A tool the process serves but `tools` omits reaches nobody.
- `views: [{id, entry, live?, csp?}]` — `id` lowercase letters, digits and inner hyphens, at most 40; `entry` an HTML page under `ui/`, as `ui/board.html`. A view shows only where another point places it. `live: true` keeps a result view running while scrolled away, within the feed's budget: hang no lasting work on it. `csp` declares outside origins as MCP Apps does: `frameDomains` for embedded players, `resourceDomains` for images, media, fonts, scripts and styles, `connectDomains` for fetch and sockets, `baseUriDomains`; an entry naming this machine or a bare address is dropped.
- `results: [{tool, view}]` — draws the feed entry of a call to an `agents` or `own` tool with the view.
- `surfaces: [{view, title, icon?}]` — a project section at `/<project>/p/<id>/<view>` with a rail item and a palette action; `title` at most 40; `icon` an svg, png, webp, gif or jpg under `ui/`.
- `panes: [{view, title, icon?}]` — a side pane.
- `launchers: [{view, title}]` — a palette action and a rail button opening the view in a window: an OS window on the desktop, a floating panel on the web; `title` at most 60.
- `pins: [{view}]` — views a thread may pin above its feed.
- `agents: [{id, path}]` — agent definitions (Agents of a plugin).
- `on: {ended}`, `schedule: [{name, everyMs, tool}]`, `notify: {tool}`, `beforeBuild: [{tool, title}]` — tools Tagma itself calls. Leave them out of `tools`, so no agent sees them.

A point that cannot register fails the process at start, the reason naming it: a view missing from `views`, a result for a tool `tools` does not give to `agents` or `own`, a tool the process does not serve, a tool name past 64 characters, an agent file that does not parse.

## The process

- Serve MCP over stdio. Stdout carries the protocol alone; write logs to stderr. In TypeScript `@modelcontextprotocol/sdk` with `StdioServerTransport` serves it; add dependencies in the plugin directory with its package manager. Exit when the host closes stdin: `StdioServerTransport` does not watch for it, so its `onclose` never fires then — listen for `end` on `process.stdin` yourself. A process still running after that is stopped with SIGTERM, and every stop of the plugin waits for it first. The `example` reference is a whole plugin.
- Mark a tool that changes nothing with `annotations: {readOnlyHint: true}`; any other asks the operator before each call in review mode, and `destructiveHint: true` makes that question a destructive one.
- Answer a failure as a result with `isError: true` and the reason as text; a thrown error is a protocol fault.
- Every `tools/call`, `resources/read` and `resources/subscribe` carries its caller in `params._meta["runlith/caller"]`:
  - `{kind: "agent", projectId, agentId, ownerId, thread: {threadId, runId, bindings} | null}` — an agent calling a tool;
  - `{kind: "operator", projectId, view, threadId?}` — a view acting for the operator;
  - `{kind: "tagma", projectId, reason}` — Tagma itself; `reason` is `schedule`, `notification`, `ended` or `build`, and `projectId` is null for `schedule` and `notification`.

  The host fills it: attribution, not authentication. One process serves every project, so key data and resource URIs by `projectId` and refuse a caller whose project is another.
- Resources feed views: declare `resources: {subscribe: true}` in the server's capabilities, answer `resources/read` for URIs of your own scheme (`notes://project/7`), and send `notifications/resources/updated {uri}` when one changes; a subscribed view reads it again. Each distinct caller — another project or view — arrives with its own `resources/subscribe`: admit or refuse it there. Further mounts with the same caller share that admission, and `resources/unsubscribe` comes once the last of them leaves.

## Calling Tagma

`POST $TAGMA_SERVER_URL/api/op/<operation>?project=<projectId>` with `content-type: application/json` and `x-tagma-caller: $TAGMA_CALLER`, the input as the JSON body; take the project from the caller the work came from. A 2xx answers the operation's result, its `status` naming the arm (`loaded`, `started`, `pinned`…); a refusal answers another status with `{code, reason, unblock}`. The header `tagma-answer: text` adds the answer's compact text, the one an agent reads, as `_meta.text` beside the document. `tagma op <operation> --help` prints an operation's meaning, grammar and refusals, and an input missing a field refuses `body-shape` naming it.

Open to a plugin process — every other operation refuses `external-refused`:
- `create_thread`, `start_turn`, `queue_turn`, `continue_thread`, `restart_thread`, `read_statuses`, `read_endings`, `read_thread`, `archive_thread` — the threads it drives;
- `pin_view`, `unpin_view` — `{threadId, plugin, view, key}` for a view in `contributes.pins`, else `view-not-pinnable`; the same address keeps one pin, and a pin outlives stopping the plugin;
- `delete_worktree` — a worktree its thread stood in, once that thread rests: `create_thread` with `worktree: "new"` answers it as `snapshot.thread.place.rootId`. Uncommitted work is committed onto the branch first, and a terminal or command still holding the folder refuses `root-in-use`;
- `send_notification` (Schedules, notifications and build steps);
- the built-in browser's page, profile and cookie operations.

## Threads a plugin drives

- `create_thread` opens a thread without a turn: a root with `title`, `type` (an agent id; `<plugin>.<agent>` for its own), `bindings`, `approvalMode` and `account`, or a child with `parent` and `task`. `bindings` is a string map kept on the thread and handed back as `thread.bindings` in every call its agent makes: put the plugin's own keys there (`table`, `seat`) to know which thread is calling.
- `bindings.plugin: "<id>"` makes the thread the plugin's: its turn endings reach `on.ended`, and the plugin may `archive_thread` it with its subtree, or bring it back with `archived: false`. A thread not bound to the caller refuses `plugin-thread-mismatch`.
- `start_turn {threadId, text, key}` opens a run or joins the one going. The required `key` makes the send repeatable: the same key and text answer the same run with `acted: false`, other text under it refuses `key-reused`. `queue_turn` queues the message behind the running run.
- `on.ended` receives `{threadId, runId, status, failureReason}` from caller `tagma` after every turn of a thread bound to the plugin; keep-warm and compaction runs do not count. An error answer, or the process not running at that moment, delivers it again later until its attempts run out, when `read_endings` shows `notification-exhausted`: take it idempotently by `runId`. A plugin running in no project, or one without `on.ended`, gets none; stopping it only in the thread's project does not stop them. `read_statuses` and `read_endings` read the same facts by thread id.

## Agents of a plugin

`contributes.agents` ships `{id, path}`: `id` the agent, lowercase letters, digits and inner hyphens; `path` its Markdown definition relative to the plugin directory, in the format the `agent-definitions` skill describes. A plugin agent:
- is offered as `<plugin>.<agent>` only where the plugin is enabled, to the operator and to external callers such as its process, not to other agents unless `agent.offered` opens it; the agent library shows it read-only;
- must list `capabilities` (`[]` for none of the standard tools); `plugin:<id>` is added to them and carries the `own` tools, named `plugin__<id>__<tool>` in a `tools` allowlist;
- has its threads born in `trust` unless the creator names a mode, so its own tools do not ask the operator at each call.

An error in any of the plugin's agent files fails the whole contribution.

## Views

A view is an ordinary page on the plugin's own origin — `http://<id>.localhost:<port>` on the server's machine, the plugin's own HTTPS port through Tailscale from another device — so it loads its scripts, styles and images from `ui/` by relative URL and may embed outside widgets. Its CSP reaches only the plugin; the view's `csp` opens outside origins. A browser that does not resolve `*.localhost` (some Safari versions) shows no views and says so.

The view speaks JSON-RPC 2.0 with its host over `window.parent.postMessage` — the MCP Apps protocol, version `2026-01-26` — and takes only messages whose `event.source` is `window.parent`:

1. Request `ui/initialize` with `{protocolVersion, appInfo, appCapabilities}`. The answer's `hostContext` carries `tagma: {projectId, plugin, view, threadId?, key?}` (`threadId` in a thread's feed or pin, `key` in a pin), `theme` (`light` or `dark`), `styles.variables` (the MCP Apps CSS variables, `--color-background-primary` and the rest, valued from Tagma's theme), `containerDimensions`, `locale` and `timeZone`.
2. Post the notification `ui/notifications/initialized`; the host notifies nothing before it.
3. Post `ui/notifications/size-changed {height}` whenever the page's height changes. A frame in the feed is capped at a share of the window; sections and panes fill their space.

Requests the view sends — at most 64 in flight; any other method answers `-32601`:
- `tools/call {name, arguments}` — a `view` tool of its plugin, else `plugin-tool-unoffered`; the process sees caller `operator`. The answer is the MCP result: `content`, `structuredContent`, `isError`.
- `resources/read {uri}`; `resources/subscribe {uri}`, `resources/unsubscribe {uri}` — updates arrive as `notifications/resources/updated {uri}`, and a subscription survives restarts and crashes of the process.
- `ui/open-link {url}` — an `http` or `https` link, only during a click inside the view.
<!-- bridge-methods -->

The methods above are the ones this installation serves; a method outside the list answers `-32601`. A notification arrives as a JSON-RPC notification of that name. A `Reference:` names a section of this skill: ask for it in `references` of `load_skill`.

Messages the host sends:
- `ui/notifications/host-context-changed` with a new `theme`, `styles` or `containerDimensions`;
- `ui/resource-teardown`, a request: answer it with `{}` within a second, then the frame goes;
- in a result view, `ui/notifications/tool-input {arguments}`, then `ui/notifications/tool-result` with the stored MCP result, or `ui/notifications/tool-cancelled {reason}`. The feed may draw the view days after the call: draw from these, not from a fresh call.

Views mount only in a project where the plugin is enabled and running; elsewhere a result shows as an ordinary tool card.

## Schedules, notifications and build steps

- **Schedules.** Each `schedule` entry `{name, everyMs, tool}` — `name` unique in the plugin, `everyMs` at least 1000 — calls its tool on a grid of `everyMs` with `{name, scheduledAt, startedAt, skipped}` from caller `tagma`; `skipped` counts the grid points already passed when the run started, so after sleep or downtime one run stands for them. One run goes at a time, and the next is the first grid point after it ends: points passed during a run are dropped. An error answer is recorded as that run's outcome and not retried off the grid. A run cut by a server stop runs again after start: make a tick's effects idempotent by `name` and `scheduledAt`. The schedule belongs to the machine's process: a plugin running in no project, or uninstalled, has no ticks, and running it again resumes the same grid. `read_schedules` (the operator's) shows each under owner `plugin:<id>` with its last run.
- **Notifications.** With `contributes.notify.tool` the process may call `send_notification {title, body?, question?, key?}`; without it the call refuses `sender-required`. The notification reaches the Attention list and paired phones; `question: {text, options}` asks, with up to 4 options or `[]` for a free-text answer. The same `key` from the same sender answers the first notification with `repeated: true`. At most 20 stand open per plugin. The operator's answer or dismissal reaches the notify tool as `{id, title, kind, answer, at}` (`kind` `answered` or `dismissed`), handed again until the tool answers without error: take it idempotently by `id`. Stopping or uninstalling the plugin leaves its open questions standing.
- **Build steps.** Each `beforeBuild` entry `{tool, title}` runs when an update from a checkout (Latest commit or Working tree, `tagma update`) builds the checkout of a project where the plugin is enabled, before the source is cut: the tool gets `{offer, checkout}` from caller `tagma` with reason `build` and answers one JSON text — `{"verdict":"go"}`, `{"verdict":"pending"}` (asked again a second later, with no deadline), or `{"verdict":"stop","reason":"…","thread":"<id>"?}`, which ends the update unbuilt and shows the reason, with Open thread when it names a thread of that project. An error, another answer or a process that ends stops the update too; a call cut by the MCP request window is asked again. An enabled plugin still starting is waited for, and one whose process failed stops the update, since its steps cannot be told. A commit the step lands is the one built. The card shows `title` while the step runs; stepping back runs no step.

## Building one

1. Decide the points from what the operator asked for, with the shapes above.
2. Write the directory in the project's `.tagma-plugins/<id>/` and add the process's dependencies there; commit it without `node_modules`.
3. `install_plugin` from the folder, then `read_plugins` until `process.state` is `running` with the expected `tools`; `refused` or `failure` names the cause.
4. An `agents` tool reaches your own thread too, deferred: reveal `plugin__<id>__<tool>` with tool_search and call it. A `view` tool is reached only from its view.
5. Edit and read the row again: the process restarts itself, and nothing needs the Tagma server restarted.
6. Open each view where it lives — the section, the pane, the result in a thread — and check it draws and acts.

## When it does not work

- `refused` on the row — `tagma-plugin.json` is missing or does not decode; the reason names the field. `process.refused` — an edit the running process cannot take, such as a `contributes` entry its point does not accept; it keeps its old declaration until the next edit.
- `process.state: failed` — a point did not register, and the reason names it; or the process would not start or exited, and the reason ends with its stderr. An exited process returns by itself after the backoff; a declaration waits for the next edit.
- `running` with `tools: 0` — the process lists none, or the plugin has no process.
- A tool missing from an agent's catalog — the plugin is not enabled in that project, the tool's audience is not `agents`, or the agent lacks the `plugins` capability.
- A blank view — it never posted `ui/notifications/initialized`, it listens to a source other than `window.parent`, or its CSP blocks what it loads; the browser console names the last.
