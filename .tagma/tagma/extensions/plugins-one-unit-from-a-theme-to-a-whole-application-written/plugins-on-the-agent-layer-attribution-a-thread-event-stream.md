---
id: 01a1ad4a-de84-7ddc-9396-cf6ac4451a7e
title: "Plugins on the agent layer: attribution, a thread event stream, our thread inside a plugin, additions to our chat"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a118eb-3e7e-7085-8f2e-2cca6433136a
  - kind: relates
    to: 01a118eb-3e7e-7085-8f2e-2cce9f3bb3f9
  - kind: relates
    to: 01a118f1-5f59-7eb8-856a-a0deb7bb8a8f
  - kind: relates
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
  - kind: relates
    to: 01a14bc0-7704-77d5-b31a-ec5a94567243
  - kind: relates
    to: 01a1511d-dca1-74d7-be94-9acf7a4ff805
  - kind: supersedes
    to: 01a1ad38-1242-70ee-bdd8-5fbf5a36577a
---
Child of [[d2b5f488]]. Read from the code at `8c5a90fcf` and `11f23bfc7` on 2026-11-05, and revised after a product review and an architecture review the same day. Nothing was run.

## Outcome

A plugin works with Tagma's agents at three depths, built in this order:
1. **Its own chat on our agents.** It starts threads, shows their work live in its own interface, answers their questions, and stops them.
2. **Our thread inside a plugin.** It shows a thread, whole, in its own section or window.
3. **Additions to our chat.** It adds a composer part, a command, a tool card or a check on a tool call, and never takes the conversation over.

All of it goes through the SDK ([[5067fa15]]).

## What stands under all three

- **The door attributes, it does not prove.** An app's process calls `POST /api/op/<id>` with `x-tagma-caller: app:<id>`. `identityOf` (`invocation/admission/identity.ts`) turns that header into the actor `external {name}`. The same process sends no header and is the operator: the local door checks only Host and Origin (`composition/http/local.ts`). Any process of the person's OS user can act as the person, and that is outside this spec.
- **Open to `external`:** `create_thread`, `start_turn`, `queue_turn`, `continue_thread`, `restart_thread`, `read_thread`, `read_statuses`, `read_endings`, `archive_thread`, `pin_view`, `unpin_view`, `delete_worktree`, `send_notification`, the browser operations and the browser feeds.
- **Closed to `external`:**
  - every thread feed (`callers: 'operator'`, `threads/contract/wire/feeds.ts`);
  - the socket-only operator acts `answer_question` (an `ask_user` question or a review-mode confirmation), `steer_turn`, `stop_run` and `set_thread_authority`;
  - `set_thread_model`. `create_thread` takes no `model`.
- **Questions already have routing.** A question goes to an approver through `ApproversPort.route` (`packages/agent/src/thread/Approvers.ts`, `run/questionRouting.ts`).
- **Feeds** are Effect RPC over WebSocket at `/api/ws`. Bun's `idleTimeout` (`composition/server.ts`) cuts a connection that stays quiet.
- **Chat slots take members at run time.** `ThreadCommands`, `ThreadTools`, `ThreadKinds`, `ComposerParts` and `FeedParts` (`app/src/lib/features/threads/native/contribution.ts`) do. They are `tier: 'app'` points, so a member shows in every project. Each composer part and feed part receives `SlotOwners`: ten app-internal classes, none of them promisable.
- **A whole thread** is `Conversation.svelte`. It needs only `host: ThreadSlot`, and resolves 17 app services through `getContext(APP)`, so it renders inside the mounted app on the window's own Svelte.
- **Hooks on tool calls exist for plugins.** The `plugin-hooks` rule (`native-harness/turns/pluginHooks.ts`) runs the hooks of enabled Claude Code and Codex plugins through one runner (`plugins/contract/service/hooks.ts`) and one answer protocol:
  - points: `beforeTool`, `afterTool`, `beforeStep`, `beforeClose`, `threadStarted`, `threadEnded`;
  - answers: deny, rewrite, context, guide;
  - failure: open, or closed per handler with `onFailure: "block"`.

  Hooks run in parallel with no cap.

## Attribution

A plugin's process calls with its caller name, `plugin:<id>`. The SDK sends it, so no author handles it. The name attributes and routes — the plugin's threads, its endings, the questions routed to it. It guards nothing, and no grant or signature is built for it, because a process that sends no name is the person (rule 06e41b6f).

Two checks remain, because they are the product's meaning rather than a guard:
- **Projects.** A plugin acts only in projects where it is enabled; `?project=` is checked against "enabled in this project", the `invocation` port that `plugins` fills.
- **Threads.** A plugin may act on any thread of such a project, the person's own included: an hourly note into a person's thread is a real use. A thread a plugin creates carries `bindings.plugin` and belongs to it.

## Depth 1 — the plugin's own chat on our agents

**Today.** A trainer works if its agent answers through tools:
- it creates its agent's thread and sends turns;
- it receives its `own` tools' calls, with `threadId` and `runId`;
- it gets each run's end through `on.ended`.

It cannot show live text or other tools' calls, answer a question or a confirmation, steer or stop a run, list models, or choose a model per thread.

**What changes.**
- **`threads`: a public thread projection, `thread.events`.** The chat's wire feed (`threadWireFeedEventSchema`) is the chat kit's own shape, which [[a0a16218]] declined to hand out. The projection is one pure function in `threads/contract/wire`, and every event carries its position `at`:
  - `snapshot {entries, before}`: one page of committed entries with the cursor to page back. It comes first on subscribe, and again whenever the producer rewrites history;
  - `status`: the `RunStatus` of [[9f3bb3f9]];
  - `entry {id, runId, role: user | assistant | tool | question | notice, text?, tool?, question?}`: once per committed entry;
  - `open {id, kind: text | tool, …}` and `append`: for the assistant text and the tool calls in flight;
  - `removed`: for withdrawn and rewound entries.

  The producer applies the function to the same records and revision as the wire feed, the way `threads.presence` is produced. The window applies the same function to its own thread session for `tagma.threadEvents`. So one implementation serves two call sites, and no consumer refolds (rule 51c66cb6). Unknown roles decode as open variants. The projection changes only by addition.
- **The door: `GET /api/feed/<id>`** answers NDJSON:
  - only for feeds that stream and are declared `external`; acts go through `POST /api/op`;
  - through the same RPC handler as the socket, never a second feed runner;
  - with a heartbeat line within the server's idle timeout;
  - over many thread ids in one stream, as `threads.presence` takes `threadIds[]`, never one connection per thread.

  `browser.screencast` keeps the socket, because its acknowledgement pacing has no HTTP counterpart.
- **Questions route to the plugin.** A thread bound to a plugin routes its questions and confirmations through `ApproversPort` to `plugin:<id>`. `answer_question` admits whoever the question was routed to, with an HTTP door; the person may also answer. `stop_run` and `steer_turn` admit a plugin on its own threads. How such questions reach the person's phone and Attention belongs to the synchronisation of notifications, outside this spec.
- **Where a plugin's threads stand.** A plugin's threads always stand under the plugin on its card. The manifest's `threads.listed` (false by default), or `listed` on one `create_thread`, also places them in the general thread list.
- **Models.** An `external` read of the person's model rows, and `model {provider, model, reasoning}` on `create_thread`, over the definition's own choice.
- **One question to a model, with no thread.** An `external` operation, `ask_model {prompt, model?, schema?}`, answers through `ModelAsks`, which rule 93f04f23 already names as the door for asking a model outside a turn. The SDK offers it as `ctx.tagma.models.ask(prompt, {model, schema})`. It spends on the person's selected model, and the plugin's card shows that spending.
- **The SDK** offers `ctx.tagma.op` for the acts and `threads.events(ids, {since})` for the stream, with resume from `at`.

A program beside Tagma that is not a plugin reaches the same door and stream. It names itself with the caller header to be attributed, or acts as the person.

## Depth 2 — our thread inside a plugin

**Today.** A page view has `tagma/thread` over `threads.presence` ([[94567243]]): the run's life and the line being said. `tagma/open` opens a thread in Tagma's own pane, on a click.

**What changes.**
- **`app/src/lib/features/threads`: a fixed-thread seat.** `ThreadSlot.start` already takes any section scope and any `SlotWriter`. A seat whose writer holds one thread id, wrapped in `PaneGraph` and `Conversation`, shows the same thread as the side pane, and two holders share one session.
- **A Svelte view** places `<Thread id={threadId} />` from `@runlith/tagma/ui`. The host module behind that facade is the window's own component.
- **A bundled view** calls `tagma.mountThread(element, id)`. The host mounts `<Thread>` with Svelte's `mount(…, {target, context})`, passing the app context captured where the view was mounted, and returns the disposer. The bundled framework never touches Svelte.

Either way the thread is whole — composer, tool cards, model picker, every feature contribution — and it is the person's own interface acting as the person.

**Rejected:** publishing `@runlith/chat-ui` over `ChatConnection`. Mounted alone, it lacks Tagma's markdown and block references, tool renderers, model picker and uploads. It would also make the kit's protocol types a public contract.

## Depth 3 — additions to our chat

**Slot faces replace `SlotOwners`.**
- A composer part and a slash command get `{thread: {id, projectId, status}, draft: {text, setText, insert, attach}, send}`.
- A tool card for one of the plugin's own tools gets `{name, input, output, state: running | done | refused, threadId}`.
- A pinned view stays the `pins` point.

Three rules hold for every slot:
- A slot's owner shows a plugin's part only in threads of projects where the plugin is enabled.
- A part's module loads when the plugin is enabled.
- Each mount sits in its own `<svelte:boundary>`.

A plugin writes no feed entries of its own. Entries decode only installed kinds, which [[a0a16218]] declined to open, and a tool card covers the cases.

**Hooks join the existing seat.**
- **Declaring.** A plugin declares `hooks: [{at, match, onFailure?, timeoutMs?}]` over the points and answers `plugin-hooks` already carries.
- **Calling.** A dialect for Tagma's format calls the hook through its process's admitted call, instead of spawning a command. One rule and one answer protocol serve every format.
- **Matching.** Only calls matching `match` leave the server.
- **Waking the process.** A matching hook counts as a demand that starts an idle process.
- **Bounds.** The rule caps how many hooks run at once, and each hook has a timeout, 10 s by default.
- **Failure** stays open by default, and closed per hook.

**Where a hook acts.** Tagma's own loop: Tagma's own threads, and Tagma's agent hosted by an outside runner ([[8e0f35a1]]). Under rule [[7a4ff805]] a hook does not reach a foreign CLI's own tools. There Tagma answers only what the CLI asks — an ACP `session/request_permission`, or the hook Tagma installs in a terminal CLI — and Claude over ACP runs with `bypassPermissions`. The plugin's card says a hook binds Tagma's own loop. Hooks are not extended into a foreign CLI's own tools: rule [[7a4ff805]] settles it, and no new question is raised.

## Order and acceptance

1. **Attribution and projects.** A plugin's call naming a project where it is disabled is refused. A thread it creates carries `bindings.plugin`, and that thread's questions route to `plugin:<id>`.
2. **Depth 1.** A trainer plugin:
   - creates its agent's thread on a chosen model;
   - streams `GET /api/feed/thread.events` with live text and a running tool call;
   - answers a review-mode confirmation routed to it;
   - stops a run, and resumes the stream from `at` after a dropped connection.

   `thread.events` and the window's projection come from the one function. A quiet stream outlives the idle timeout.
3. **Depth 2**, after the parent spec's module host:
   - a section lists merge requests beside a live `<Thread>`;
   - a React bundle shows a thread through `tagma.mountThread`;
   - a shortcut on a free chord opens a grid of four threads on four providers.
4. **Depth 3:**
   - a composer button inserts text into the draft, and shows only in projects where its plugin is enabled;
   - a Svelte tool card draws the plugin's own tool;
   - a throwing part breaks only itself;
   - a `beforeTool` hook from a plugin in Tagma's format denies a matching call and starts the plugin's idle process;
   - the same call with the plugin failing proceeds, unless `onFailure: "block"`.

## Risks and not established

- **A public contract.** The projection's vocabulary, the slot faces and the hook protocol become a versioned contract under the SDK's surface version.
- **Latency.** A matching hook adds a process round trip to the tool call, and a start when the process is idle.
- **Not established:**
  - that `Conversation` draws correctly in a seat without a pane, reasoned from `ThreadSlot`'s arguments and not run;
  - the memory of one long-lived stream per subscriber.
