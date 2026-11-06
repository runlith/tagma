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
Child of [[d2b5f488]]. Read from the code at `8c5a90fcf` and `11f23bfc7` on 2026-11-05, and revised after two rounds of product and architecture review the same day; nothing was run.

## Outcome

A plugin works with Tagma's agents at three depths, built in this order:
1. **Its own chat on our agents.** It starts threads, shows their work live in its own interface, answers their questions, and stops them.
2. **Our thread inside a plugin.** It shows a thread, whole, in its own section or window.
3. **Additions to our chat.** It adds a composer part, a prompt command, a tool card or a check on a tool call, and never takes the conversation over.

All of it goes through the SDK ([[5067fa15]]).

## What stands under all three

- **The door attributes, it does not prove.** An app's process calls `POST /api/op/<id>` with `x-tagma-caller: app:<id>`, and `identityOf` (`invocation/admission/identity.ts`) turns the header into the actor `external {name}`. The same process sending no header is the operator, because the local door checks only Host and Origin (`composition/http/local.ts`). Any process of the person's OS user can act as the person, and that is outside this spec.
- **Open to `external`:** `create_thread`, `start_turn`, `queue_turn`, `continue_thread`, `restart_thread`, `read_thread`, `read_statuses`, `read_endings`, `archive_thread`, `pin_view`, `unpin_view`, `delete_worktree`, `send_notification`, the browser operations and the browser feeds.
- **Closed to `external`:**
  - every thread feed (`callers: 'operator'`, `threads/contract/wire/feeds.ts`);
  - the socket-only operator acts: `answer_question` (an `ask_user` question or a review-mode confirmation), `steer_turn`, `stop_run` and `set_thread_authority`;
  - `set_thread_model`. `create_thread` takes no `model`.
- **Questions already have routing.** A question goes to an approver through `ApproversPort.route`, and routing ends in `ApproversPort.notify` (`packages/agent/src/thread/Approvers.ts`, `run/questionRouting.ts`).
- **Feeds** are Effect RPC over WebSocket at `/api/ws`. Bun's `idleTimeout` (`composition/server.ts`) cuts a quiet connection.
- **Chat slots take members at run time.** `ThreadCommands`, `ThreadTools`, `ThreadKinds`, `ComposerParts` and `FeedParts` (`app/src/lib/features/threads/native/contribution.ts`) do. They are `tier: 'app'` points, so a member shows in every project. Each composer and feed part receives `SlotOwners`: ten app-internal classes, none of them promisable.
- **A whole thread** is `Conversation.svelte`. It needs only `host: ThreadSlot`, and resolves 17 app services through `getContext(APP)`, so it renders inside the mounted app, on the window's own Svelte.
- **Hooks on tool calls exist for plugins.** The `plugin-hooks` rule (`native-harness/turns/pluginHooks.ts`) runs the hooks of enabled Claude Code and Codex plugins through one runner (`plugins/contract/service/hooks.ts`) and one answer protocol:
  - points: `beforeTool`, `afterTool`, `beforeStep`, `beforeClose`, `threadStarted`, `threadEnded`;
  - answers: deny, rewrite, context, guide;
  - failure: open, or closed per handler with `onFailure: "block"`.

  These hooks run in parallel with no cap.

## Attribution

A plugin's process calls under its caller name, `plugin:<id>`. The SDK sends it, so no author handles it. The name attributes and routes: the plugin's threads, its endings, the questions routed to it, its spending. It guards nothing, and no grant or signature is built for it, because a process that sends no name is the person (rule 06e41b6f).

Two checks remain, because they carry the product's meaning rather than guard against anything:
- **Projects.** A plugin acts only in projects where it is enabled. `?project=` is checked against "enabled in this project", the `invocation` port that `plugins` fills.
- **Threads.** A plugin may act on any thread of such a project, the person's own included: an hourly note into a person's thread is a real use. Such a turn carries the plugin as its sender, and the feed shows it as sent by the plugin. A thread the plugin creates carries `bindings.plugin` and belongs to it.

## Depth 1 — the plugin's own chat on our agents

**Today.** A trainer works if its agent answers through tools:
- it creates its agent's thread and sends turns;
- it receives the calls of its `own` tools, with `threadId` and `runId`;
- it gets each run's end through `on.ended`.

It cannot show live text or other tools' calls, answer a question or a confirmation, steer or stop a run, list models, or choose a model per thread.

**What changes.**
- **`threads`: a public thread projection, `thread.events`.** The chat's wire feed (`threadWireFeedEventSchema`) is the chat kit's own shape, which [[a0a16218]] declined to hand out. The projection is one pure function in `threads/contract/wire`. Each event carries its thread and that thread's position `at`:
  - `snapshot {entries, before}`: one page of committed entries, with the cursor to page back. It comes when a subscription names no position for that thread, and again when the producer rewrites history or changes epoch.
  - `status`: the `RunStatus` of [[9f3bb3f9]].
  - `entry {id, runId, role: user | assistant | tool | question | notice, sender?, text?, tool?, question?}`: once per committed entry. A restore emits its entries again.
  - `open {id, kind: text | tool, …}` and `append`: for the assistant text and the tool calls in flight.
  - `removed`: for withdrawn and rewound entries.

  A subscription with a position for a thread receives only the deltas after it. `read_thread_events {threadId, before, limit}`, an `external` read, pages the projection back from `before`.

  The producer applies the function to the same records and revision as the wire feed, the way `threads.presence` is produced. The window applies the same function to its own thread session for `tagma.threadEvents`, so one implementation serves both, and no consumer refolds (rule 51c66cb6).
- **The door: `GET /api/feed/<id>`** answers NDJSON:
  - only for streaming feeds declared `external`; acts go through `POST /api/op`;
  - through the same RPC handler as the socket, never a second feed runner;
  - with a heartbeat line within the server's idle timeout;
  - over many thread ids in one stream, as `threads.presence` takes `threadIds[]`, with `since` a map from thread id to position.

  `browser.screencast` keeps the socket, because its acknowledgement pacing has no HTTP counterpart. While a plugin's process holds an open stream, the process counts as busy and does not idle out.
- **Questions reach the plugin.** A thread bound to a plugin routes its questions and confirmations through `ApproversPort` to `plugin:<id>`.
  - **Delivery.** The question reaches the plugin as an `onQuestion` contribution, delivered as endings are: at least once, through the notification obligation (note f2afdfd3), and waking an idle process.
  - **Answering.** The handler answers through `answer_question`, which admits whoever the question was routed to, with an HTTP door. The handler may also leave the question to the person, who can answer it in the thread.
  - **A plugin that cannot answer.** While the plugin is broken or switched off, its questions route to the person.
  - **Runs.** `stop_run` and `steer_turn` admit a plugin on its own threads.

  How questions reach the person's phone and Attention belongs to the synchronisation of notifications, outside this spec.
- **Where a plugin's threads stand.** Under the plugin's section or rail entry when it has one, otherwise on its card. The manifest's `threads.listed` (false by default), or `listed` on one `create_thread`, also places them in the general thread list.
- **Models.**
  - An `external` read of the person's model rows.
  - `model {provider, model, reasoning}` on `create_thread`, which takes precedence over the definition's own choice.
- **One question to a model, with no thread.** An `external` operation, `ask_model {prompt, model?, schema?}`, answers through `ModelAsks`; rule 93f04f23 already names `ModelAsks` as the door for asking a model outside a turn. `ModelAsks` records each ask's usage under its caller, and the plugin's card reads that record. Spending goes on the person's selected model.
- **The SDK** offers `ctx.tagma.op` for the acts, `threads.events(since)` for the stream, and `models.ask` for one question.

A program beside Tagma that is not a plugin reaches the same door and stream. It names itself with the caller header to be attributed, or acts as the person.

## Depth 2 — our thread inside a plugin

**Today.** A page view has `tagma/thread` over `threads.presence` ([[94567243]]): the run's life and the line being said. `tagma/open` opens a thread in Tagma's own pane, on a click.

**What changes.**
- **`app/src/lib/features/threads`: a fixed-thread seat.** `ThreadSlot.start` already takes any section scope and any `SlotWriter`. A seat whose writer holds one thread id, wrapped in `PaneGraph` and `Conversation`, shows the same thread as the side pane, and two holders share one session.
- **A Svelte view** places `<Thread id={threadId} />` from `@runlith/tagma/ui`. The host module behind that facade is the window's own component.

The thread is whole — composer, tool cards, model picker, every feature contribution — and it is the person's own interface, acting as the person.

**Rejected:** publishing `@runlith/chat-ui` over `ChatConnection`. Mounted alone, it lacks Tagma's markdown and block references, tool renderers, model picker and uploads, and it would make the kit's protocol types a public contract.

## Depth 3 — additions to our chat

**Slot faces in place of `SlotOwners`.**
- A composer part and a prompt command get `{thread: {id, projectId, status}, draft: {text, setText, insert, attach}, send}`.
- A tool card for one of the plugin's own tools gets `{name, input, output, state: running | done | refused, threadId}`.
- A pinned view stays the `pins` point.

Every slot keeps three rules:
- its owner shows a plugin's part only in threads of projects where the plugin is enabled;
- a part's module loads when the plugin is enabled;
- each mount sits in its own `<svelte:boundary>`.

A plugin writes no feed entries of its own. Entries decode only installed kinds, which [[a0a16218]] declined to open, and a tool card covers the cases.

**Hooks join the existing seat.**
- **Declaring.** A plugin declares `hooks: [{at, match, onFailure?, timeoutMs?}]`, over the points and answers `plugin-hooks` already carries.
- **Calling.** Like every contribution, a `hooks` contribution carries its `caller`. The runner in `plugins` calls a Tagma-format hook through that caller instead of spawning a command. It never imports `plugin-host`. One rule and one answer protocol serve every format.
- **Matching.** Only calls matching `match` leave the server.
- **Waking.** A matching hook is a demand: it wakes an idle process.
- **Bounds.** The rule caps how many hooks run at once. Each hook has a timeout, 10 s by default.
- **Failure** stays open by default, and closed per hook.

**Where a hook acts.** In Tagma's own loop: Tagma's own threads, and Tagma's agent hosted by an outside runner ([[8e0f35a1]]). Under rule [[7a4ff805]] a hook does not reach a foreign CLI's own tools. There Tagma answers only what the CLI asks — an ACP `session/request_permission`, or the hook Tagma installs in a terminal CLI — and Claude over ACP runs with `bypassPermissions`. The plugin's card says in plain words that a hook checks Tagma's agent, not Claude Code or Codex.

## Order and acceptance

1. **Attribution and projects.**
   - A plugin's call naming a project where it is disabled is refused.
   - A thread it creates carries `bindings.plugin`, and that thread's questions route to `plugin:<id>`.
   - A turn it sends into a person's thread shows as sent by the plugin.
2. **Depth 1.** A trainer plugin:
   - creates its agent's thread on a chosen model;
   - streams `GET /api/feed/thread.events` with live text and a running tool call;
   - answers, in `onQuestion`, a review-mode confirmation routed to it while its process was idle;
   - stops a run;
   - resumes the stream from its positions after a dropped connection, with no snapshot.

   Its `ask_model` spending shows on its card. `thread.events` and the window's projection come from the one function. A quiet stream outlives the idle timeout. A question to a broken plugin reaches the person.
3. **Depth 2**, after the parent spec's module host:
   - a section lists merge requests beside a live `<Thread>`;
   - once the parent spec's window entries land (its last step), a shortcut on a free chord opens a window holding a grid of four threads on four providers.
4. **Depth 3:**
   - a composer button inserts text into the draft, and shows only in projects where its plugin is enabled;
   - a Svelte tool card draws the plugin's own tool;
   - a throwing part breaks only itself;
   - a `beforeTool` hook from a plugin in Tagma's format denies a matching call, and wakes the plugin's idle process;
   - the same call proceeds while the plugin fails, unless `onFailure: "block"`.

## Risks and not established

- **A public contract later.** The projection's vocabulary, the slot faces and the hook protocol change with Tagma in one commit while rule [[0528876d]] stands, and become a versioned contract once it is cancelled.
- **Latency.** A matching hook adds a process round trip to the tool call, and a start when the process is idle.
- **Not established:**
  - that `Conversation` draws correctly in a seat without a pane, which is reasoned from `ThreadSlot`'s arguments and not run;
  - the memory of one long-lived stream per subscriber.
