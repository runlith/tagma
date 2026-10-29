---
name: apps
description: Build, change, install or debug a Tagma app — an application inside Tagma with no deploy: its process, views, agents and what it calls in Tagma. Load before writing or editing anything in a project's `.tagma-apps/<id>/` or the operator's apps directory; when the operator asks for an app, a bridge to a service, a board, a game or a section inside Tagma; when read_apps shows an app refused or failed or an app view does not open. Connecting an existing MCP server is add_mcp_server.
---

# Apps

An app is an application inside Tagma with no deploy: a directory `<id>/` holding `tagma-app.json`. The manifest names an optional process — any program serving MCP over stdio — and the app's contributions by point: tools for agents, views drawn in the window, agents, thread endings, schedules, notifications, secrets. One process serves the whole machine; a project sees the app only while it is enabled there.

## Where it lives and how it runs

- **Directory.** `.tagma-apps/<id>/` in a project, or `apps/<id>/` in the server's data directory for the operator's own. One you build for the operator goes into the project's `.tagma-apps`. The directory name is the id, and `tagma-app.json` repeats it.
- **Install, enable, uninstall.** `install_app` records the directory on the machine, starts the process and enables the app in this project; `enabled: false` installs it, or keeps it installed, with its process stopped for the whole machine. `enable_app` shows or hides an installed app per project; its process, schedules and thread endings run either way. `uninstall_app` ends the process, withdraws the app from every project and drops its secret values; its directory and data stay. An id standing in both directories refuses `app-collision`, one already installed from another directory `app-source-taken`.
- **State.** `read_apps` answers each app this project finds or the machine has installed: `root`, `installed`, `enabled` here, `state` (`stopped`, `starting`, `running`, `failed`), how many `tools` its process serves, `restarts`, `failure` — the point that did not register, or why the process would not start or exited, ending with what it wrote to stderr — and `refused` — why the directory as it stands now cannot run, while a running process keeps the declaration it started with.
- **Restarts.** A change to its files restarts the process, except `ui/` at the top, `node_modules` and `.git` at any depth, and what the app's own `.gitignore` names; an edited view shows on its next load. Calls arriving during a restart wait for the new process; calls in flight get 10 s to finish. A manifest that no longer passes keeps the running process and shows `refused` until the next edit. A process that exits loses its contributions and returns after a backoff from 1 to 60 s, reset once it lives 30 s; a call during the backoff refuses at once.
- **Environment.** The process runs as the operator, in its app directory, with `TAGMA_SERVER_URL`, `TAGMA_CALLER` (`app:<id>`), `TAGMA_APP_DATA`, `TAGMA_APP_REVISION` (a hash of its code files' paths, sizes and modification times, not their content) and each secret that has a value. Keep state in `TAGMA_APP_DATA` — `app-data/<id>/` in the server's data directory, made before start — which outlives restarts and uninstalling. A file the process writes inside its own directory restarts it unless `.gitignore` names it.

## tagma-app.json

Read `read_app_schema` before writing one: it is the schema this server accepts, every point described, and an unknown key refuses. What the schema cannot say:

- `tools` — `{name, audience}` per tool of the process. `agents`: every agent with the `apps` capability in a project where the app is enabled, deferred, as `app__<id>__<tool>`, at most 64 characters. `own`: only the app's own agents. `view`: only its views; no model sees it. A tool the process serves but `tools` omits reaches nobody.
- `views` — HTML pages in `ui/`. A view shows only where another point places it: `results` draws the feed entry of an `agents` or `own` tool call with it; `pins` lists views a thread may pin above its feed; `surfaces` adds a project section at `/<project>/p/<app>/<view>` with a rail item and a palette action; `panes` a side pane; `launchers` a palette action and a rail button opening it in a window — an OS window on the desktop, a floating panel on the web. `live: true` keeps a result view running while scrolled away, within the feed's budget: hang no lasting work on it.
- `agents` — agent definitions shipped as Markdown files (Agents of an app).
- `on.ended`, `notify.tool`, `schedule[].tool` — tools Tagma itself calls. They need no entry in `tools`; leave them out so no agent sees them.
- `secrets` — `name` is the environment variable the value arrives in, never one every process starts with (`PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `TMPDIR`).

An app without `process` still carries views, their placements and agents; `tools`, `on`, `notify` and `schedule` need one. A point naming a view missing from `views`, a result for a tool `tools` does not give to `agents` or `own`, or a tool the process does not serve installs, then fails at start with the reason in `read_apps`.

## The process

- Serve MCP over stdio. Stdout carries the protocol alone; write logs to stderr. In TypeScript `@modelcontextprotocol/sdk` with `StdioServerTransport` serves it; add dependencies in the app directory with its package manager. Exit when the host closes stdin. The `example` reference is a whole app.
- Mark a tool that changes nothing with `annotations: {readOnlyHint: true}`; any other asks the operator before each call in review mode, and `destructiveHint: true` makes that question a destructive one.
- Answer a failure as a result with `isError: true` and the reason as text; a thrown error is a protocol fault.
- Every `tools/call`, `resources/read` and `resources/subscribe` carries its caller in `params._meta["runlith/caller"]`:
  - `{kind: "agent", projectId, agentId, ownerId, thread: {threadId, runId, bindings} | null}` — an agent calling a tool;
  - `{kind: "operator", projectId, view, threadId?}` — a view acting for the operator;
  - `{kind: "tagma", projectId, reason}` — Tagma itself; `reason` is `schedule`, `notification` or `ended`, and `projectId` is null except for `ended`.

  The host fills it: attribution, not authentication. One process serves every project, so key data and resource URIs by `projectId` and refuse a caller whose project is another.
- Resources feed views: declare `resources: {subscribe: true}` in the server's capabilities, answer `resources/read` for URIs of your own scheme (`notes://project/7`), and send `notifications/resources/updated {uri}` when one changes; a subscribed view reads it again. Each distinct caller — another project or view — arrives with its own `resources/subscribe`: admit or refuse it there. Further mounts with the same caller share that admission, and `resources/unsubscribe` comes once the last of them leaves.

## Calling Tagma

`POST $TAGMA_SERVER_URL/api/op/<operation>?project=<projectId>` with `content-type: application/json` and `x-tagma-caller: $TAGMA_CALLER`, the input as the JSON body; take the project from the caller the work came from. A 2xx answers the operation's result, its `status` naming the arm (`loaded`, `started`, `pinned`…); a refusal answers another status with `{code, reason, unblock}`. The header `tagma-answer: text` adds the answer's compact text, the one an agent reads, as `_meta.text` beside the document. `tagma op <operation> --help` prints an operation's meaning, grammar and refusals, and an input missing a field refuses `body-shape` naming it.

Open to an app process — every other operation refuses `external-refused`:
- `create_thread`, `start_turn`, `queue_turn`, `continue_thread`, `read_statuses`, `read_endings`, `read_thread`, `archive_thread` — the threads it drives;
- `pin_view`, `unpin_view` — `{threadId, app, view, key}` for a view in `contributes.pins`, else `view-not-pinnable`; the same address keeps one pin, and a pin outlives disabling the app;
- `send_notification` (Secrets, schedules and notifications);
- the built-in browser's page, profile and cookie operations.

## Threads an app drives

- `create_thread` opens a thread without a turn: a root with `title`, `type` (an agent id; `<app>.<agent>` for its own), `bindings`, `approvalMode` and `account`, or a child with `parent` and `task`. `bindings` is a string map kept on the thread and handed back as `thread.bindings` in every call its agent makes: put the app's own keys there (`table`, `seat`) to know which thread is calling.
- `bindings.app: "<id>"` makes the thread the app's: its turn endings reach `on.ended`, and the app may `archive_thread` it with its subtree, or bring it back with `archived: false`. A thread not bound to the caller refuses `app-thread-mismatch`.
- `start_turn {threadId, text, key}` opens a run or joins the one going. The required `key` makes the send repeatable: the same key and text answer the same run with `acted: false`, other text under it refuses `key-reused`. `queue_turn` queues the message behind the running run.
- `on.ended` receives `{threadId, runId, status, failureReason}` from caller `tagma` after every turn; keep-warm and compaction runs do not count. An error answer, or the process not running at that moment, delivers it again a minute later, at most three times: take it idempotently by `runId`. An app uninstalled, installed stopped or running without `on.ended` gets none; hiding it from the thread's project with `enable_app` does not stop them. `read_statuses` and `read_endings` read the same facts by thread id.

## Agents of an app

`contributes.agents` ships `{id, path}`: a definition file in the app directory, in the format the `agent-definitions` skill describes. An app agent:
- is offered as `<app>.<id>` only where the app is enabled, to the operator and external callers such as its process, not to other agents by default; the agent library shows it read-only;
- must list `capabilities` (`[]` for none of the standard tools); `app:<id>` is added to them and carries the `own` tools, named `app__<id>__<tool>` in a `tools` allowlist;
- has its threads born in `trust` unless the creator names a mode, so its own tools do not ask the operator at each call.

An error in any of the app's agent files fails the whole contribution.

## Views

A view is an ordinary page on the app's own origin — `http://<id>.localhost:<port>` on the server's machine, the app's own HTTPS port through Tailscale from another device — so it loads its scripts, styles and images from `ui/` by relative URL and may embed outside widgets. Its CSP reaches only the app; the view's `csp` opens outside origins: `frameDomains` for embedded players, `resourceDomains` for images, media, scripts and styles, `connectDomains` for fetch and sockets. A browser that does not resolve `*.localhost` (some Safari versions) shows no views and says so.

The view speaks JSON-RPC 2.0 with its host over `window.parent.postMessage` — the MCP Apps protocol, version `2026-01-26` — and takes only messages whose `event.source` is `window.parent`:

1. Request `ui/initialize` with `{protocolVersion, appInfo, appCapabilities}`. The answer's `hostContext` carries `tagma: {projectId, app, view, threadId?, key?}` (`threadId` in a thread's feed or pin, `key` in a pin), `theme` (`light` or `dark`), `styles.variables` (the MCP Apps CSS variables, `--color-background-primary` and the rest, valued from Tagma's theme), `containerDimensions`, `locale` and `timeZone`.
2. Post the notification `ui/notifications/initialized`; the host notifies nothing before it.
3. Post `ui/notifications/size-changed {height}` whenever the page's height changes. A frame in the feed is capped at a share of the window; sections and panes fill their space.

Requests the view sends — at most 64 in flight; any other method answers `-32601`:
- `tools/call {name, arguments}` — a `view` tool of its app, else `app-tool-unoffered`; the process sees caller `operator`. The answer is the MCP result: `content`, `structuredContent`, `isError`.
- `resources/read {uri}`; `resources/subscribe {uri}`, `resources/unsubscribe {uri}` — updates arrive as `notifications/resources/updated {uri}`, and a subscription survives restarts and crashes of the process.
- `ui/open-link {url}` — an `http` or `https` link, only during a click inside the view.
- `tagma/open` — `{threadId, beside?}` opens a thread, `{section: <view>}` or `{pane: <view>}` a section or pane the app contributes; only during a click inside the view.
- `tagma/storage/get {key}` answers `{stored, value?}`; `tagma/storage/set {key, value}` keeps a JSON value of at most 1 MiB, and without `value` removes it. The values stand in the app's data directory, shared by all its views, projects and devices.
- `tagma/thread {threadId}` answers `{threadId, life, runId, text, ended}` — whether a run is going, the reply as it streams or the last line said, how the last run ended — or `{threadId, missing}`; each change follows as `tagma/notifications/thread` until `tagma/thread/unwatch {threadId}` or teardown.
- `tagma/speech {action, …}` — recognition, call transcripts and spoken replies through Tagma's speech: the `speech` reference.

Messages the host sends:
- `ui/notifications/host-context-changed` with a new `theme`, `styles` or `containerDimensions`;
- `ui/resource-teardown`, a request: answer it with `{}` within a second, then the frame goes;
- in a result view, `ui/notifications/tool-input {arguments}`, then `ui/notifications/tool-result` with the stored MCP result, or `ui/notifications/tool-cancelled {reason}`. The feed may draw the view days after the call: draw from these, not from a fresh call.

Views mount only in a project where the app is enabled and running; elsewhere a result shows as an ordinary tool card.

## Secrets, schedules and notifications

- **Secrets.** The operator gives a declared secret its value in Settings → Apps → Secrets (`set_secret` with owner `tagma-apps` and the app's id is the operator's alone): tell them which secret to set there, never ask for the value in chat, where it would stand in the feed. The process restarts once with it in its environment; Tagma masks the value in everything the process answers over MCP, not in what the process sends over HTTP. The fields show once an enabled app's manifest was read, so a process lacking a secret stays up and answers what is missing.
- **Schedules.** Each `schedule` entry calls its tool on a grid of `everyMs` with `{name, scheduledAt, startedAt, skipped}` from caller `tagma`; `skipped` counts the grid points already passed when the run started, so after sleep or downtime one run stands for them. One run goes at a time, and the next is the first grid point after it ends: points passed during a run are dropped. An error answer is recorded as that run's outcome and not retried off the grid. A run cut by a server stop runs again after start: make a tick's effects idempotent by `name` and `scheduledAt`. The schedule belongs to the machine's process: installing the app stopped or uninstalling it stops the ticks, installing it running resumes the same grid, and `enable_app` changes nothing. `read_schedules` (the operator's) shows each with its last run.
- **Notifications.** With `contributes.notify.tool` the process may call `send_notification {title, body?, question?, key?}`; without it the call refuses `sender-required`. The notification reaches the Attention list and paired phones; `question: {text, options}` asks, with up to 4 options or `[]` for a free-text answer. The same `key` from the same sender answers the first notification with `repeated: true`. At most 20 stand open per app. The operator's answer or dismissal reaches the notify tool as `{id, title, kind, answer, at}` (`kind` `answered` or `dismissed`), handed again until the tool answers without error: take it idempotently by `id`. Stopping or uninstalling the app leaves its open questions standing.

## Building one

1. Decide the points from what the operator asked for, and read `read_app_schema`.
2. Write the directory in the project's `.tagma-apps/<id>/` and add the process's dependencies there; commit it without `node_modules`.
3. `install_app`, then `read_apps` until the row is `running` with the expected `tools`; `refused` or `failed` names the cause.
4. An `agents` tool reaches your own thread too, deferred: reveal `app__<id>__<tool>` with tool_search and call it. A `view` tool is reached only from its view.
5. Edit and read the row again: the process restarts itself, and nothing needs the Tagma server restarted.
6. Open each view where it lives — the section, the pane, the result in a thread — and check it draws and acts.

## When it does not work

- `refused` — `tagma-app.json` or a point fails the schema; the reason names it. A running process keeps its old declaration. A directory holding no `tagma-app.json` is refused with the path it looked for.
- `failed` — a point did not register (a tool the process does not serve, a view missing from `views`, an agent file that does not parse), and the reason names it; or the process would not start or exited, and the reason ends with its stderr. An exited process returns by itself after the backoff; a declaration waits for the next edit.
- `running` with `tools: 0` — the process lists none, or the app has no process.
- A tool missing from an agent's catalog — the app is not enabled in that project, the tool's audience is not `agents`, or the agent lacks the `apps` capability.
- A blank view — it never posted `ui/notifications/initialized`, it listens to a source other than `window.parent`, or its CSP blocks what it loads; the browser console names the last.
