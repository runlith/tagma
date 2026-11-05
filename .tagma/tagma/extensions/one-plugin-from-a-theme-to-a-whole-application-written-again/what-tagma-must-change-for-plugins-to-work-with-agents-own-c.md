---
id: 01a1ad38-1242-70ee-bdd8-5fbf5a36577a
title: "What Tagma must change for plugins to work with agents: own chat on our agents, our thread inside a plugin, additions to our chat"
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a118ac-1a50-7aba-9bbf-abf721acc718
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
---
Draft for the operator, not accepted: what the three depths agreed in [[c1891844]] would take, read from the code at `8c5a90fcf` on 2026-11-05 with nothing run. "Recommend" marks the reader's choice where the operator has not ruled.

## What stands under all three

- **The door does not know who an app is.** An app process calls `POST /api/op/<id>` with `x-tagma-caller: app:<id>`; `identityOf` (`invocation/admission/identity.ts`) turns the header into actor `external {name}` with no proof, and `?project=` resolves any registered project, enabled or not (`admission/project.ts`). The same process sending no header is admitted as the operator: the local door checks only Host and Origin (`composition/http/local.ts`) and holds no credential. So `external` narrows a caller that chooses to be narrowed; the only boundary a process plugin cannot cross is the OS user.
- **Open to `external`:** `create_thread`, `start_turn`, `queue_turn`, `continue_thread`, `restart_thread`, `read_thread`, `read_statuses`, `read_endings`, `archive_thread`, `pin_view`, `unpin_view`, `delete_worktree`, `send_notification`, the browser operations and the five browser feeds. Only `archive_thread` checks that the thread's `bindings.app` names the caller (`threads/operations/acts.ts`); turns go to any thread of any project.
- **Closed.** Every thread feed — `thread.subscribe`, `threads.subscribe`, `threads.presence`, `attention.subscribe`, `threads.pulse` and the socket acts — is `callers: 'operator'` without `external` (`threads/contract/wire/feeds.ts`). `answer_question`, which answers both an `ask_user` question and a review-mode confirmation (a question of kind `thread.tool.confirm`, `packages/agent/src/thread/run/Questions.ts`), and `steer_turn`, `stop_run`, `set_thread_authority` are socket-only operator acts (`socketAct` in `threads/contract/wire/operations/turns.ts`). `answer_approval` is the verb an agent answers its child's approval with, not the operator's answer. `set_thread_model` and the model defaults are operator-only; `read_models` is an agent tool, not an operation; `ModelAsks` (`providers/contract/service/asks.ts`) sits behind no operation that takes a free prompt.
- **A thread's model** comes from its agent definition's `model` field, else the operator's defaults (`threads/birth/acts.ts`, `native-harness/models/preference.ts`); `create_thread` has no `model`.
- **Feeds** are Effect RPC over WebSocket at `/api/ws` (`socket/live.ts`); the HTTP door has no streaming route. On the local door the upgrade's headers reach feed admission, so an `external: true` feed is already reachable by a process that speaks Effect RPC.
- **Chat slots take members at run time.** `ThreadCommands`, `ThreadTools`, `ThreadKinds`, `ComposerParts`, `FeedParts` (`app/src/lib/features/threads/native/contribution.ts`) and `Surfaces` are points without `joins: 'start'`; `Panes` takes members only at start. App result views already register tool renderers into every conversation's `EntryKinds` at run time (`tagmaAppViews.feed.svelte`). Each composer and feed part receives `SlotOwners`: ten app-internal classes (`ShownThread`, `ChatHold`, `ThreadDraft`, …), none of them promisable.
- **Where a thread can mount.** `ChatSurface` from `@runlith/chat-ui` mounts with no app service: the kit's stand (`packages/chat-ui/stand/Surface.svelte`) gives it a turns object, five owners it builds itself, preferences, navigation and rendering callbacks, and strings in context. The app's `Conversation.svelte` resolves 17 app services with `.use()` and takes a `ThreadSlot` that `threadSlot()` builds from a side pane and `ThreadSeats`. `.use()` reads `getContext(APP)` (`packages/layer/src/svelte/App.svelte.ts`), so a whole thread renders anywhere under the mounted app on the window's own `svelte`, and nowhere else.
- **The window** loads no outside code at run time (no dynamic import of a computed URL anywhere in `apps/tagma/app/src`), sets no `script-src` (the remote door adds only `frame-ancestors`, `composition/http/remote.ts`), compiles Tailwind only from the `@source` paths of `app.css`, and pins Svelte `5.57.0`. A module route reaches the remote door only under `/api/` and behind device admission ([[8c5b6812]]).

The earlier preparation is the ground this stands on: the chat refactor [[b7bb8a8f]] built one session per thread for any number of holders and registries for composer, entry, tool and region contributions; the agent refactor [[6433136a]] built `RunStatus`, keyed `admit`, the caller in MCP `_meta` and the rule registry used below. Of its tasks, [[175758d8]] and [[2d5c76ec]] are done, and [[e239d4dc]] (the app's 700-line debt) is open and blocks none of this.

## Depth 1 — a plugin's own chat on our agents

**Today.** A language trainer is buildable now if its agent answers through tools: the process births `trainer.tutor` (`create_thread`, model from the definition, born in trust), sends turns with `start_turn`, receives every call of its `own` tools with `thread.threadId` and `runId` in `_meta`, gets each run end through `on.ended`, and draws cards in an iframe view from its resource. It cannot show text as it streams or calls of other tools, answer a question or confirmation, steer or stop, list models, or choose one per thread.

**What changes.**
- **`threads` (server): a public thread projection.** Recommend a new feed, `thread.events`, rather than opening `thread.subscribe`: that feed's event is `threadWireFeedEventSchema` — snapshot, resume, state records of any installed entry kind, open-entry patches — the shape the chat kit folds and changes with it, which [[a0a16218]] already refused to hand out. The projection: `status` (the `RunStatus` that [[9f3bb3f9]] made the one answer to run life); `entry` per committed entry, `{id, runId, role: user | assistant | tool | question | notice, text?, tool?: {name, callId, input, output, outcome}, question?: {questionId, confirm, options}}`; `text` appends to the open assistant entry; `removed` for withdrawn and rewound entries; `reset` when a cursor fell out of the producer's window. It is derived at the producer from the same records and revision as the wire feed, as `threads.presence` is, never refolded by a consumer, and it changes by addition only.
- **The door (composition, invocation): an HTTP stream of any feed declared `external`.** `GET /api/feed/<id>` answering NDJSON or SSE, admitted by the same `admitFeed` as the socket, so any language reads it and the remote door admits it under `/api/`. It is feed-generic: the browser feeds gain it too. The socket stays the window's.
- **Admission (invocation, threads): one `bound` scope.** Recommend declaring which thread operations an external caller may use only on threads whose `bindings.app` names it, judged once in admission instead of inside `archive_thread`: `thread.events`, `answer_question`, `stop_run` and `steer_turn` open under it with HTTP doors, and the already-open turn and read operations narrow to it. It means something only with the identity below.
- **Models (native-harness, threads/birth).** A read of the operator's model rows for `external`, and `model {provider, model, reasoning}` on `create_thread` over the definition's.
- **The SDK.** `@runlith/tagma-sdk/plugin` gives the process typed calls over these: `threads.create`, `threads.events(id, {since})` as an async iterator with resume, `send`, `answer`, `stop`, `models.list`. A native plugin in the window gets the same entry type from a reactive `tagma.thread(id)` reading the window's existing `ThreadSession`, not a second subscription.
- **A one-shot model call** (`ModelAsks.text` behind an operation) is not needed here: a thread of the plugin's own agent grades an answer, visibly and stoppably. Spending the operator's account with no thread to show for it is a product decision.

**A separate program beside Tagma** reaches all of this today as the operator — the `tagma` CLI itself subscribes to `thread.subscribe` over Effect RPC (`threads/cli/turnVerbs.ts`). It lacks only the HTTP stream and the published client; whether it runs as the operator or as a caller the operator names is open.

**Cost.** Medium: the projection with an equivalence test on the existing feed-pair corpus, the stream door, the admission scope, a models read, the SDK client. The weight is the entry vocabulary — how much of tool and product entries is promised.

## Depth 2 — our thread inside a plugin

**Today.** An iframe view has `tagma/thread` over `threads.presence` ([[94567243]]): run life, run id, the line being said, ended. No feed, no composer, no entries; `tagma/open` opens a thread in Tagma's own pane, on a click.

**What changes.**
- **App client, `features/threads`: a fixed-thread seat and a public `<Thread>`.** `ThreadSlot.start` already takes any section scope and any `SlotWriter`; what ties it to panes is `threadSlot()`, `followThread` and `paneThread`. A seat whose writer holds one thread id, wrapped in `PaneGraph` and `Conversation`, shows the same thread as the side pane, and two holders share one session.
- **App build and shell document: a table of host modules.** `<Thread>` resolves its services only when the plugin runs on the window's `svelte` and renders inside the app. The build emits stable chunks for `svelte`, `svelte/internal/client` and `@runlith/tagma-sdk/ui`, and the shell document an import map naming them; a plugin compiled by Tagma imports them as bare specifiers. Today everything is bundled under hashed names, and nothing from outside can share the runtime.
- **Server, `tagma-apps` and `views`: compile at install.** Tagma compiles a native plugin's `.svelte` sources with its own compiler and runs Tailwind over them with `app.css`'s theme, in a worker ([[7a910861]]), and again after every Tagma update; the output is served under `/api/tagma-apps/<id>/`. A source the current compiler rejects leaves the plugin `refused` with the compiler's message.
- **Foreign bundles.** `tagma.thread(element, id)` becomes a host call: the host mounts `<Thread>` into the element with Svelte's `mount(…, {target, context})`, passing the app context captured where the plugin is mounted, and returns the disposer. The foreign framework never touches Svelte.

**Contract.** Native: `<Thread id={threadId} />` imported from `@runlith/tagma-sdk/ui`. Foreign: `tagma.thread(element, threadId) → dispose`. Both draw the whole thread — composer, tool cards, model picker, every feature contribution.

**Recommend against** making `@runlith/chat-ui` the SDK's component over `ChatConnection`, as [[c1891844]] proposes. Mounted alone the kit is a chat without Tagma's markdown and block references, tool renderers, model picker or uploads: the plugin would rebuild our thread from rendering callbacks, and the SDK would publish the kit's and `@runlith/agent`'s protocol types as a versioned contract. The host component keeps the kit private and the thread whole.

**Cost.** Medium to large, and most of it belongs to every native plugin view rather than to threads: the module table, the compile pipeline, the module route. The thread part is small.

## Depth 3 — additions to our chat

**Today.** The points accept members at run time, and iframe tool cards (`results`) and pins already use them. Agent rules are a runtime registry: `AgentRuleRegistry.register` returns a disposer, native adapters contribute rules through their manifests ([[c2a15b7e]]), a `beforeTool` rule answers `deny` or `rewrite` for one call, an `afterTool` rule sees the outcome and answers `guide` (`packages/agent/src/agent/policy/AgentRuntimePolicy.ts`, `door/ToolAdmission.ts`, `door/ToolExecution.ts`). The verdict and confirmation ports are fixed in `AgentRunner.ts` (`ToolJudge`, `declaredConfirmations`).

**What changes.**
- **App client: promised faces in place of `SlotOwners`.** A composer part and a slash command get `{thread: {id, projectId, status}, draft: {text, setText, insert, attach}, send}`; a tool card gets `{name, input, output, state: running | done | refused, threadId}` for the plugin's own tools; a pinned view stays the `pins` point. A native plugin registers into the existing points as their contributor; disabling it disposes.
- **No plugin-written feed entries yet.** Entries decode only installed kinds (`WireEntryKinds`); a plugin kind would be a server-declared kind per plugin with a lasting schema and text for the model, which [[a0a16218]] declined. A tool card covers the examples.
- **`native-harness`: one rule source per plugin hook.** A manifest entry `hooks: [{at: beforeTool | afterTool, tool, match}]` registers a rule, owned by `tagma-apps`, that calls the plugin's tool through `TagmaApps.callAdmitted` with the call `{name, input, toolCallId}` and the calling thread, and maps the answer to nothing, `deny`, `rewrite` or `guide`. Only calls matching `match` leave the server, so an unmatched call costs nothing. A failing or slow rule is non-critical today: a `rule-failed` or `rule-slow` note, and the call proceeds.
- **Where a hook acts.** Tagma's own loop: native threads, and Tagma's agent hosted by an outside runner, which runs the same door and rules ([[8e0f35a1]]). Under [[7a4ff805]] the seat does not reach a foreign CLI's own tools: Tagma answers only what the CLI asks — an ACP `session/request_permission` judged through `HarnessJudging` (`external-harnesses/protocol/questions.ts`), or the hook Tagma installs in a terminal CLI (`judge_harness_call`, `external-harnesses/hooks/dispatch.ts`). A plugin check could at most join that answer as allow or deny, and only on calls the CLI reports: Claude over ACP runs with `bypassPermissions` and never asks about Bash or Edit, and `plain` mode reports nothing. Recommend that the first cut binds Tagma's loop only and that the manifest says so.

**Cost.** Small for the hook seat, since the registry exists; small to medium for the slot faces. The contract — match, timeout, failure policy, caller shape — is the work.

## Across the depths

**Identity first.** Opening streams and approvals to a header anyone can write would hand a plugin's threads to any program naming it. Recommend a grant like a thread's: the supervisor puts `TAGMA_APP_GRANT` — an HMAC over `app:<id>` with the server's existing grant key (`platform/credentials/grants.ts`) — into the process environment, admission answers `external {name}` only for a valid grant and refuses a bare `x-tagma-caller`, and `?project=` is checked against the app being enabled there. It proves the call came from the process Tagma launched, or from something that read its environment as the same OS user; it does not protect against that user, and install says so. It keeps the single outside caller kind of [[9f3bb3f9]] and settles that spec's open authentication question without a plugin-specific kind. Small: `identity.ts` and `tagma-apps/generation.ts`.

**The stream** is the new public `thread.events` for any reader outside the window, over a feed-generic HTTP stream; inside the window, the same entry type from the kit's session. Never the wire feed, whose shape is the chat's.

**Showing our thread** takes the host's `<Thread>`, not a mountable `chat-ui`: the window's Svelte through the import map, the app context through a child mount or `mount` with context, styles from the document both share (tokens are `app.css` variables), and Tailwind classes compiled by Tagma. What is promised about Svelte is its version 5 source language, recompiled by each Tagma, never its internals.

**Slots:** composer part, slash command, tool card for the plugin's own tools, pinned view; the sidebar keeps sections and panes. **Hooks** sit on `AgentRuleRegistry` at `beforeTool` and `afterTool`, never in the verdict or confirmation ports, which carry the thread's approval law.

**Order.**
1. Identity and the bound scope.
2. Depth 1: the projection, the stream door, approvals and models, the SDK client — accepted by the trainer in an iframe view with live text and an answered confirmation. A separate program beside Tagma rides on this step.
3. The window's module host: module table, compile pipeline, module route.
4. Depth 2: the fixed seat and `<Thread>` — accepted by a section listing merge requests beside a live thread.
5. Depth 3: slot faces and the hook seat — accepted by a composer button, a native tool card and a `beforeTool` check that denies a call.

**Risks.** The projection, the slot faces and the module table become a versioned contract against the practice of one form changed in one commit — the exception for outside authors that [[6433136a]] left open. A native module runs with the window's rights, the operator's socket included, and the consent rule has to say so. Every hook adds a process round trip to each matching call. The server ships the Svelte compiler and Tailwind's native binary on every platform. A hung native module hangs the window.

**Open for the operator.** Whether a hook may fail closed, blocking every matching call while its plugin is down. Whether plugins get a one-shot model call. Whether a separate program beside Tagma is the operator or a caller he names. Whether hooks ever reach foreign CLI threads.

**Not established.** That `Conversation` draws correctly in a seat without a pane — reasoned from `ThreadSlot`'s arguments, not run. That Vite emits stable `svelte` and `svelte/internal/client` chunks the app's own code also imports through the import map. That the desktop window loads from the local door's origin, which serving modules same-origin assumes. Tailwind's cost per plugin and the order of its stylesheet against `app.css`. Whether the MCP stdio spawn hands the server's own environment to an app process. The memory and latency of a long-lived HTTP stream per subscriber.
