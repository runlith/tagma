---
id: 01a1ad4a-de84-7ddc-9396-cf6ac4451a7e
title: "Plugins on the agent layer: a proven identity, a thread event stream, our thread inside a plugin, additions to our chat"
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
Child of [[d2b5f488]]. Read from the code at `8c5a90fcf` and `11f23bfc7` on 2026-11-05; nothing was run.

## Outcome

A plugin works with Tagma's agents at three depths, built in this order:
1. It runs its own chat over our agents: it starts threads, shows their work live in its own interface, answers their questions and stops them.
2. It shows our thread, whole, inside its own section or window.
3. It adds to our chat — a composer part, a command, a tool card, a check on a tool call — without taking the conversation over.

A separate program beside Tagma reaches depth 1 through the same stream and client.

## What stands under all three

- **The door does not know who a plugin is.**
  - An app process calls `POST /api/op/<id>` with `x-tagma-caller: app:<id>`. `identityOf` (`invocation/admission/identity.ts`) turns the header into actor `external {name}` with no proof.
  - `?project=` resolves any registered project, enabled or not (`admission/project.ts`).
  - The same process sending no header is the operator: the local door checks only Host and Origin (`composition/http/local.ts`).
- **Open to `external`.** `create_thread`, `start_turn`, `queue_turn`, `continue_thread`, `restart_thread`, `read_thread`, `read_statuses`, `read_endings`, `archive_thread`, `pin_view`, `unpin_view`, `delete_worktree`, `send_notification`, the browser operations and the five browser feeds. Only `archive_thread` checks that the thread's `bindings.app` names the caller (`threads/operations/acts.ts`); turns go to any thread of any project.
- **Closed.**
  - Every thread feed is `callers: 'operator'` (`threads/contract/wire/feeds.ts`).
  - `answer_question` answers both an `ask_user` question and a review-mode confirmation (`packages/agent/src/thread/run/Questions.ts`). It, `steer_turn`, `stop_run` and `set_thread_authority` are socket-only operator acts (`socketAct`, `threads/contract/wire/operations/turns.ts`).
  - `set_thread_model` and the model defaults are the operator's. `create_thread` takes no `model`: the model comes from the agent definition, else the operator's defaults (`threads/birth/acts.ts`).
- **Feeds** are Effect RPC over WebSocket at `/api/ws`; the HTTP door has no streaming route.
- **Chat slots take members at run time.** `ThreadCommands`, `ThreadTools`, `ThreadKinds`, `ComposerParts`, `FeedParts` (`app/src/lib/features/threads/native/contribution.ts`) and `Surfaces` have no `joins: 'start'`. Each composer and feed part receives `SlotOwners`: ten app-internal classes, none of them promisable.
- **A whole thread** is `Conversation.svelte`, which resolves 17 app services through `.use()` over `getContext(APP)`. It renders anywhere under the mounted app, on the window's own Svelte, and nowhere else.
- **Hooks on tool calls already exist for plugins.** The `plugin-hooks` rule (`native-harness/turns/pluginHooks.ts`) runs the hooks of enabled Claude Code and Codex plugins through the plugins module's one runner (`plugins/contract/service/hooks.ts`):
  - points: `beforeTool`, `afterTool`, `beforeStep`, `beforeClose`, `threadStarted` and `threadEnded`;
  - answers: deny, rewrite, context and guide;
  - failure: open by default, closed where a handler sets `onFailure: "block"`.

The earlier chat refactor ([[b7bb8a8f]]) and agent refactor ([[6433136a]]) built what this stands on: one session per thread for any number of holders, contribution registries, `RunStatus`, the caller in MCP `_meta` and the rule registry.

## Identity, first

A plugin's process gets `TAGMA_PLUGIN_GRANT` in its environment: an HMAC over `plugin:<id>` signed with the server's existing grant key (`platform/credentials/grants.ts`).
- Admission answers `external {name}` only for a valid grant, and refuses a bare caller header.
- `?project=` must name a project where the plugin is enabled.

The grant proves that the call came from the process Tagma launched, or from something that read its environment as the same OS user; it does not separate plugins from that user. It keeps the single outside caller kind of [[9f3bb3f9]] and settles that spec's open authentication question. Owners: `invocation/admission/identity.ts` and the `plugin-host` supervisor.

**The bound scope.** Thread operations declare, once in admission, that an external caller may use them only on threads whose `bindings.plugin` names it. This replaces the one check inside `archive_thread`.
- The turn and read operations already open narrow to that scope.
- `answer_question`, `stop_run` and `steer_turn` open under it, with HTTP doors.

## Depth 1 — the plugin's own chat on our agents

**Today.** A language trainer works if its agent answers through tools:
- the process creates a thread of its own agent and sends turns;
- it receives every call of its `own` tools with `threadId` and `runId` in `_meta`;
- it gets each run's end through `on.ended`;
- it draws its views from its resource.

It cannot show text as it streams or other tools' calls, answer a question or confirmation, steer or stop a run, list models, or choose one per thread.

**What changes.**
- **`threads`: a public thread projection.** A new feed, `thread.events`, not the existing `thread.subscribe`. That feed's events are `threadWireFeedEventSchema` — snapshots, state records of every installed entry kind, open-entry patches — the chat kit's own shape, which [[a0a16218]] already declined to hand out. The projection's events:
  - `status`: the `RunStatus` of [[9f3bb3f9]];
  - `entry`: per committed entry, `{id, runId, role: user | assistant | tool | question | notice, text?, tool?: {name, callId, input, output, outcome}, question?: {questionId, confirm, options}}`;
  - `text`: appended to the open assistant entry;
  - `removed`: for withdrawn and rewound entries;
  - `reset`: when a cursor falls out of the producer's window.

  It is derived at the producer, from the same records and revision as the wire feed, the way `threads.presence` is. Consumers never refold it, and it changes only by addition.
- **The door: an HTTP stream of any feed declared `external`.** `GET /api/feed/<id>` answers NDJSON. It is admitted by the same `admitFeed` as the socket, so any language reads it, and the remote door admits it under `/api/`. It is generic, so the browser feeds gain it too. The socket stays the window's.
- **Models.** An `external` read of the operator's model rows, and `model {provider, model, reasoning}` on `create_thread` over the definition's choice.
- **The SDK.** `@runlith/tagma-sdk/plugin` gives the process typed calls: `threads.create`, `threads.events(id, {since})` as an async iterator with resume, `send`, `answer`, `stop`, `models.list`. A native view in the window gets the same entry type from a reactive `tagma.thread(id)` that reads the window's existing thread session, never a second subscription.

**A separate program beside Tagma** reaches the same stream and client. Today it already reaches everything as the operator — the `tagma` CLI subscribes to `thread.subscribe` over Effect RPC (`threads/cli/turnVerbs.ts`) — and it lacks only the HTTP stream and the published client.

## Depth 2 — our thread inside a plugin

**Today.** An iframe view has `tagma/thread` over `threads.presence` ([[94567243]]): run life, run id, the line being said. `tagma/open` opens a thread in Tagma's own pane, on a click.

**What changes.**
- **`app/src/lib/features/threads`: a fixed-thread seat and a public `<Thread>`.** `ThreadSlot.start` already takes any section scope and any `SlotWriter`. What ties it to panes is `threadSlot()`, `followThread` and `paneThread`. A seat whose writer holds one thread id, wrapped in `PaneGraph` and `Conversation`, shows the same thread as the side pane, and two holders share one session.
- **Native plugins** import `<Thread id={threadId} />` from `@runlith/tagma-sdk/ui`, which the host module table of the parent spec serves.
- **Foreign plugins** call `tagma.thread(element, id)`. The host mounts `<Thread>` into the element with Svelte's `mount(…, {target, context})`, passing the app context captured where the plugin was mounted, and returns the disposer. The foreign framework never touches Svelte.

Either way the plugin gets the whole thread: composer, tool cards, model picker and every feature contribution.

**Rejected:** publishing `@runlith/chat-ui` as the SDK's thread over `ChatConnection`. Mounted alone, the kit lacks Tagma's markdown and block references, tool renderers, model picker and uploads, so the plugin would rebuild our thread from rendering callbacks. It would also make the kit's and `@runlith/agent`'s protocol types a versioned contract. The host component keeps the kit private and the thread whole.

## Depth 3 — additions to our chat

**Slot faces in place of `SlotOwners`.**
- A composer part and a slash command get `{thread: {id, projectId, status}, draft: {text, setText, insert, attach}, send}`.
- A tool card for one of the plugin's own tools gets `{name, input, output, state: running | done | refused, threadId}`.
- A pinned view stays the `pins` point.

A native plugin registers into the existing points as their contributor, and disabling it disposes the registration. A plugin writes no feed entries of its own: entries decode only installed kinds (`WireEntryKinds`), which [[a0a16218]] declined to open, and a tool card covers the cases.

**Hooks join the existing plugin hook seat.**
- A native plugin declares `hooks: [{at, tool?, match, onFailure?}]` over the same points and answers the `plugin-hooks` rule already carries.
- A dialect for native plugins calls the hook as a tool of the plugin's process, through the admitted call (`callAdmitted`), instead of spawning a command. One rule and one answer protocol serve every plugin format.
- Only calls matching `match` leave the server, so an unmatched call costs nothing.
- Failure stays open by default and closed per hook with `onFailure: "block"`, as now.

**Where a hook acts.** Tagma's own loop: native threads, and Tagma's agent hosted by an outside runner, which runs the same door and rules ([[8e0f35a1]]). Under rule [[7a4ff805]] it does not reach a foreign CLI's own tools. There Tagma answers only what the CLI asks:
- an ACP `session/request_permission`, judged through `HarnessJudging`;
- the hook Tagma installs in a terminal CLI (`judge_harness_call`).

Claude over ACP runs with `bypassPermissions` and never asks about Bash or Edit. The manifest's hook entry states that it binds Tagma's loop.

## Order and acceptance

1. **Identity and the bound scope.** A call with a forged `x-tagma-caller` and no grant is refused. A plugin's call on a thread not bound to it is refused. A call naming a project where the plugin is disabled is refused.
2. **Depth 1.** A trainer plugin creates a thread of its own agent on a chosen model, and streams it over `GET /api/feed/thread.events` with live text. It answers a review-mode confirmation, and stops a run. `thread.events` and the wire feed agree on the existing feed-pair corpus.
3. **Depth 2**, after the parent spec's module host. A section lists merge requests beside a live `<Thread>`. A foreign React pane shows a thread through `tagma.thread`. Mod+J opens a grid of four threads on four providers.
4. **Depth 3.** A composer button inserts text into the draft. A native tool card draws the plugin's own tool. A `beforeTool` hook from a native plugin denies a matching call, and the same call with the plugin's process down proceeds, unless `onFailure: "block"`.

## Open for the operator

- Whether plugins get a one-shot model call with no thread, spending his account with nothing shown in a thread.
- Whether a separate program beside Tagma is the operator, or a caller he names.
- Whether hooks ever reach a foreign CLI's own tools beyond the allow and deny questions it asks.

## Risks and not established

- **A public contract.** The projection's entry vocabulary and the slot faces become a versioned contract.
- **Hook latency.** Every hook adds a process round trip to each matching call.
- **Not established:**
  - that `Conversation` draws correctly in a seat without a pane, which is reasoned from `ThreadSlot`'s arguments and not run;
  - the memory and latency of a long-lived HTTP stream per subscriber;
  - whether the MCP stdio spawn hands the server's own environment to a plugin process.
