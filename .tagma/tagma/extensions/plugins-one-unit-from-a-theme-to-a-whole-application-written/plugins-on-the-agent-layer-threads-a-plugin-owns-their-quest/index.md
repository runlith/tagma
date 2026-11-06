---
id: 01a1ad4a-de84-7ddc-9396-cf6ac4451a7e
title: "Plugins on the agent layer: threads a plugin owns, their questions and asks, our thread in its views, additions to our chat"
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
  - kind: relates
    to: 01a1b123-680f-7ed0-9645-9d2cba083eb0
  - kind: supersedes
    to: 01a1ad38-1242-70ee-bdd8-5fbf5a36577a
---
Child of [[d2b5f488]]. Read from the code at `1977c69ce` on 2026-11-06, after steps 1–2 of the parent landed: plugins are hosted by `plugin-host`, written against `@runlith/tagma/plugin`, and call as `plugin:<id>`. It replaces the version written against `8c5a90fcf` and `11f23bfc7`. Nothing was run.

## Outcome

A person who never reads code says "make me a German trainer with a tutor", "let me answer my agent from Telegram" or "show me a merge request beside its thread", and an agent builds a plugin that works with Tagma's agents at three depths, built in this order:
1. **Its own chat on our agents.** The plugin starts threads it owns, sends them words, shows their work live in its own views, answers their questions, moves them to another model, stops them, and asks a model once with no thread.
2. **Our thread inside a plugin.** A view places a whole Tagma thread: the person's own.
3. **Additions to our chat.** A composer part, a prompt command, a tool card, or a check on a tool call of Tagma's agent. It never takes the conversation over.

All of it goes through the SDK ([[5067fa15]]).

## Decided with the operator on 2026-11-06

- **A plugin that answers takes the questions.** When a plugin declares that it answers its threads' questions, those questions leave Attention and the phone. They come back to the person only when the plugin cannot take them: its delivery failed, or the plugin is broken, switched off or removed. They also come back when the plugin's handler leaves a question to the person.
- **Ask spending shows over the activity record's window.** The plugin's card shows what its `ask_model` calls spent over `activity.keepHours`, and names that period. No counter of its own is kept.

## What a plugin gets, and where it stops

| A plugin can | Its limit |
|---|---|
| Start threads of any type, its own agents included; each is its own | Only in projects where it is enabled |
| Send words into any thread of such a project | The turn shows, to the person and to the agent, as the plugin's |
| Stop, restart, continue, archive, answer, and move to another model the threads it owns | Never a thread it does not own |
| Receive its threads' run ends and questions, which wake its process | A process gets events, never a live stream |
| Read any thread and the person's model menu | Only operations declared `external` |
| Watch threads live in its views: what each does now, and one thread's transcript | A view reads through the window and acts through its plugin's process |
| Place the person's whole thread in a view | That thread acts as the person, never as the plugin |
| Ask a model once with no thread | On the person's accounts, recorded as the plugin's |
| Check Tagma's agent's tool calls | Never Claude Code's or Codex's own tools (rule [[7a4ff805]]) |
| Add composer parts, prompt commands and tool cards | Writes no feed entry of its own |

## What stands

**Admission.** `POST /api/op/:id` reaches `callerMiddlewareLayer` (`composition/http/caller.ts`) and then `identityOf` (`invocation/admission/identity.ts`). With no session header, the raw `x-tagma-caller` value becomes `external` (`identity.ts:171-174`), and `operationCaller` (`invocation/admission/actor.ts:72-75`) makes the actor `{kind: 'external', name}`. `admitCallers` (`invocation/admission/callers.ts:16`) lets that actor through exactly the operations declared `external: true`.
- Nothing checks that `plugin:<id>` is installed, or enabled in `?project=`. Enablement is consulted only for view mounts (`views/shelf.ts`) and tool catalogs (`plugin-host/toolPoint.ts`).
- The `plugin:` form (`PLUGIN_CALLER_PREFIX`, `plugins/contract/wire/names.ts`) is parsed inside `archive_thread`'s body (`threads/operations/acts.ts:155-177`). That body alone checks that the thread's `bindings.plugin` names the caller.

**Open to an outside caller:** the 38 operations the SDK types (`packages/tagma/src/plugin/operations.generated.ts`). Among them are `create_thread`, `start_turn`, `queue_turn`, `continue_thread`, `restart_thread`, `read_thread`, `read_statuses`, `read_endings`, `archive_thread`, `pin_view`, `unpin_view` and `send_notification`. `start_turn` and `queue_turn` admit into any thread; `continue_thread` and `restart_thread` act on any thread (`threads/contract/wire/operations/catalog.ts`).

**Closed to it:**
- `steer_turn`, `answer_question`, `stop_run` and `set_thread_authority` are socket-only operator acts (`socketAct`, `threads/contract/wire/operations/turns.ts`).
- `set_thread_model` is operator-only (`native-harness/contract/wire/operations/models.ts`).
- Every thread feed — `thread.subscribe`, `threads.presence`, the native thread feeds — is `callers: 'operator'`, carried only over the `/api/ws` socket. No feed is served over plain HTTP.

**Bindings.** `create_thread` copies `bindings` from its input (`threads/contract/wire/creation.ts`, `threads/operations/routes.ts:195`), so any caller may write any `bindings.plugin`. The binding decides run-end delivery (`threads/harness/pluginEndings.ts`, explanation f2afdfd3) and `archive_thread`.

**The sender of a turn.** An outside turn is admitted as `AdmitCaller {kind: 'external', name}` (`threads/turns/caller.ts`). The inbox item's sender is still written `{kind: 'reader'}` (`inboxTurnValues`, `packages/agent/src/thread/inboxItems.ts`); the inbox sender schema knows `reader`, `thread` and `host` (`thread/storage/inbox.ts`). The name survives only in the item's id. The feed shows no sender for it (`wordsOf`, `packages/chat-ui/src/entryProjection.ts`), and the agent reads the plugin's words as the person's.

**Models.**
- A plugin's agent definition carries `model` (`agentModelSchema`, `threads/contract/wire/agentLibrary.ts`), and a birth of that type takes it (`makeBirthModels`, `native-harness/models/preference.ts`).
- `create_thread` takes no model. The window moves a new thread with the `thread.model` act (`features/threads/thread/ThreadSettings.svelte.ts`).
- Agents read the menu through `read_models` (`packages/agent/src/collaboration/CollaborationTools.ts`). It comes from the providers' catalog (`ModelCatalog.menu`), and no `external` read offers it.

**Asks.** `ModelAsks` (`providers/contract/service/asks.ts`) has no operation. It asks as `OPERATOR_PRINCIPAL` (`providers/asks.ts`). The `ask` activity (`providers/askActivity.ts`) records kind, path, provider, model and rung, but not the caller, and the record is kept for `activity.keepHours`. The model an ask runs on is a setting with the `ask` control (`providers/askSettings.ts`).

**Questions.**
- A run's question routes through `ApproversPort.route` (`packages/agent/src/thread/Approvers.ts`), whose approver is an opaque string or null, null being the person.
- The server's filler, `threadApprovers` (`threads/approvers.ts`), routes to a parent whose grant covers the question. It delivers the notice into the parent's inbox (`harness.inputs.deliver`), and reroutes open questions when a grant or an archive mark changes (explanation fb0986e6).
- A question with an approver does not stand in Attention, and push reads Attention (explanation e97547b6).
- A plugin can already ask the person a question of its own with `send_notification`, and receive the answer on its `notify` tool (`notify/operations.ts`, `composition/outcomes.ts`).

**The process side.**
- `plugin-host`'s supervisor (`plugin-host/supervisor.ts`) opens a generation on a call, a resource read or a subscription. An open subscription keeps the process from idling.
- The quiet period is `PLUGIN_QUIET`, five minutes (`plugin-host/contract/service/supervision.ts`). A crash waits behind a backoff gate, from 1 s doubling to 60 s.
- A contribution's caller is the supervisor's `call` (`supervisor.ts:402`), so any delivery through it is a demand.
- Each handler of a definition is a tool named `__<handler>` with audience `tagma` (`handlerTools`, `packages/tagma/src/plugin/protocol.ts`; note b99544e3).

**Views.**
- A view reaches the bridge methods `open`, `storage/*`, `thread` and `thread/unwatch` (`views/contract/wire/bridge.ts`), and its plugin's `view` tools. Calls to those tools reach the process with the caller `operator {view, threadId}` (explanation 178c84d6).
- `thread` is the presence projection of `threads.presence` (`threads/contract/wire/presence.ts`): run status, the open question, the line said or the streaming tail, the outcome and the model. One subscription serves a set of threads.
- The window holds threads' chats through `ThreadChats` (`app/src/lib/features/threads/ThreadChats.ts`), which can also send, answer, continue and stop as the person.

**Chat slots.**
- `ThreadCommands`, `ThreadTools`, `ThreadKinds`, `ComposerParts` and `FeedParts` (`app/src/lib/features/threads/native/contribution.ts`) are `tier: 'app'` points.
- Composer and feed parts receive `SlotOwners`, ten app-internal classes. No plugin contributes to any of these points.
- `Conversation.svelte` needs `host: ThreadSlot` and resolves its services from the app's context. `ThreadSlot` (`features/threads/ThreadSlot.svelte.ts`) is a project-tier process started with an app scope and a `SlotWriter`.

**Hooks.**
- The `plugin-hooks` rule (`native-harness/turns/pluginHooks.ts`) runs the hooks of enabled plugins at `beforeTool`, `afterTool`, `beforeStep`, `beforeClose`, `threadStarted` and `threadEnded` (`plugins/contract/wire/rows.ts`). All matching hooks of one call run at once.
- One runner (`plugins/contract/service/hooks.ts`) runs command handlers only, with each dialect's timeouts and `onFailure: 'block'`.
- Tagma's format reads `hooks: []` (`plugin-formats/tagma/format.ts`).

## Decisions

### One plugin caller, read once at admission

**Parsing.** `identityOf` reads `x-tagma-caller` once. The `external` actor gains `plugin: string | null` (`platform/contract/wire/actor.ts`): the id when the name has the `plugin:` form that `plugins`' wire declares, and null otherwise. Every reader of a plugin caller reads `actor.plugin`, and `archive_thread` stops parsing the prefix. A program beside Tagma that sends any other name stays attributed, and nothing more.

It is a field and not a new actor kind. A plugin and another outside program pass the same `external` gate, and differ only in the checks below. A new kind would add a case to every switch on `actor.kind`, with nothing different in any of them.

**Projects.** A plugin's call placed in a project refuses `plugin-not-enabled` unless the plugin runs there (`EnabledPlugins.held`, read in `invocation/admission/plugin.ts`). A machine-placed call refuses unless `plugin-host` hosts the plugin: its supervisor reconciles every plugin enabled anywhere into a slot (`plugin-host/layer.ts`).
- `invocation` asks `plugins` and `plugin-host` directly. It already sits above both through `threads`, so these are new relations on its card, not ports.
- Admission reads only the enabled set, never a plugin's directory: `EnabledPlugins.of` reads directories and stays off this path.
- This makes the scope table of [[d2b5f488]] true at the door. It is the meaning of "off here", not a guard.

**Ownership.** A thread a plugin creates is its own. `create_thread` writes `bindings.plugin` from the caller, and a `plugin` key in any caller's input refuses `binding-reserved`. Endings, questions and control below therefore rest on one writer of the binding. Children such a thread spawns are ordinary children, whose questions go to their parent.

**Control acts on its own threads only.** `stop_run`, `answer_question`, `set_thread_model`, `restart_thread`, `continue_thread` and `archive_thread` admit a plugin only on a thread whose `bindings.plugin` names it.
- The operation declares this where it declares `external`: `external: 'own'`.
- Admission checks it once, where it checks `external`, reading the thread's row. The check leaves `archive_thread`'s body.
- `stop_run` and `answer_question` gain the HTTP door they lack.
- `continue_thread` and `restart_thread` lose a plugin's reach over the person's threads. The reach of the operator and of agents is unchanged.

Adding words (`start_turn`, `queue_turn`), reading and pinning stay open on any thread of an enabled project. An hourly note into the person's own thread is a real use; stopping or answering inside his conversation is not the plugin's to do.

**The sender of a turn.** The inbox sender gains `{kind: 'external', name}` (`thread/storage/inbox.ts`), written from the `AdmitCaller` that already carries it.
- The agent reads the words as from that name, the way it reads a message from a thread.
- The feed shows the sender, and the window names a plugin caller by the plugin's title.
- `@runlith/agent` learns of an outside sender, never of plugins.

### Depth 1: events to the process, live state to the views

A plugin's process acts and reacts; a person looks through a view. The process therefore gets the events it must act on as deliveries. A view reads live thread state from the window, which already holds it. No thread stream reaches a process.

**Questions reach the plugin that takes them.**
- **The point.** The `on` point of `threads` (`threads/contract/wire/pluginEndings.ts`) gains `asked`, a tool with audience `tagma`. Its face title becomes "When a thread of this plugin ends or asks".
  - The SDK handler is `onThreadAsked`, whose tool is `__asked`.
  - Its payload, in `@runlith/tagma/plugin/protocol`, is `{threadId, questionId, summary, prompts, deadlineAt}`: the `ApprovalNotice` the route already builds.
  - The handler's caller is `tagma {projectId, reason: 'asked'}`, as an ending carries `ended`.
- **Routing.** `threadApprovers.route` answers with the thread's plugin as approver when the thread's `bindings.plugin` names a plugin whose `asked` is registered, ahead of the parent and grant cases. Otherwise it routes as today.
  - The approver stays the kit's opaque string. The server's address `plugin:<id>` stands beside thread ids, and `ApproverWhy` gains `owner`.
  - A question with a secret prompt stays with the person.
  - Routed to the plugin, a question leaves Attention and push, as any routed question does.
- **Delivery.** For a plugin address, `notify` calls the `asked` tool through the contribution's caller, which opens an idle process and waits through a backoff gate. A delivery that fails or answers `isError` reroutes that question to the person at once.
- **Registration.** When the plugin's `asked` is registered or withdrawn — enabled, switched off in that project, removed, refused — the existing reroute subscription (explanation fb0986e6) reroutes the open questions of threads bound to it. A question nobody can take therefore stands with the person.
- **Leaving it to the person.** The handler answers either an acknowledgement or `leave()`, an answer of the SDK's protocol, as a build step answers its verdict. `leave()` reroutes that question to the person at once, into Attention and push, through the same reroute as a failed delivery.
- **Answering.** An acknowledged question is answered with `answer_question`, sent at once or hours later (a reply from Telegram). The person may answer first from the thread. A confirmation keeps its deadline.
- **A plugin with no `asked`** leaves its threads' questions with the person, in Attention and push. Its views still show them (presence carries `ask`), and its process may still answer them.

**Run ends** stay as they are: `on.ended` (explanation f2afdfd3).

**Models.**
- A plugin's own agent names its model in its definition. Nothing new is needed for that.
- **Another model for one thread:** `set_thread_model` on its own thread, the act the window itself uses after a birth. `create_thread` gains no model.
- **The menu:** one `external` read of `providers`, `read_model_menu`, answering the `ModelCatalog.menu` projection that agents read through `read_models`. One fact keeps one owner (rule 51c66cb6).

**One question to a model.** `ask_model {prompt, system?, model?, schema?}` is a machine-placed `external` operation of `providers`. It answers `{text}`, or, with a JSON Schema, `{value}`, through `ModelAsks` with ask kind `text` or `object`.
- **The model** is the person's choice in one `ask`-control setting that `providers` declares; unset, `choose` takes the default for the kind. A `model` the plugin names is an explicit choice, which refuses `ask-unanswerable` rather than substitute (`ModelAsks.choose`).
- **Spending.** The ask stays the operator's request on the person's accounts. The `ask` activity gains the caller. The plugin's card reads its asks' usage from that record over its window, `activity.keepHours`, and names the period; no counter of its own is kept.
- **In the SDK,** `models.ask(prompt, {model, schema})` turns a Standard Schema into the JSON Schema and parses the answer with it, so the author's value is typed.

**Views see threads through the window.**
- **What a thread does now:** `tagma/thread`, unchanged. Presence serves any set of threads over one shared subscription.
- **One thread's transcript:** the new bridge methods `transcript {threadId}`, `transcript/older` and `transcript/unwatch`, declared by `views` beside `thread`.
  - **Served by the window,** from a chat session of its own, opened through `ThreadChats` as a pane's is, not shared with a pane on the same thread. One pure projection in `plugin-views` maps the chat fold's entries and the changes it reports since a revision, never the wire events, so no second fold exists (rule 51c66cb6).
  - **Events:** an initial page `{entries, more}`; then `entry` when one is added or changes; `removed`, for a withdrawal or a rewind; and `tail`, for the assistant's text and the tool calls in flight.
  - **An entry** is `{id, runId, role: user | assistant | tool | question | notice, sender?, text?, tool?: {name, state, input, output?}, question?: {id, prompts, answered}}`.
  - **Its schema** is declared by `threads` (`threads/contract/wire/`), the thread's owner. The bridge in this step and `useTagma().transcript(id)` of `/ui` in step 5 therefore carry one shape.
- **Acting.** A view acts on a thread through its plugin's process, by its `view` tools. Every act on a thread is then the plugin's and attributed to it. A view never acts as the person; the person's only interface inside a plugin is `<Thread>`.

**Where a plugin's threads stand** (decided in [[d2b5f488]]). The `threads` point of `threads` holds `{listed}`, false by default. The general thread list leaves out the threads of plugins that are not listed. The plugin's section or rail entry, or otherwise its card, lists its threads by their binding.

### Depth 2: our thread inside a plugin

This comes after the window's module host, step 5 of [[d2b5f488]].
- **A fixed-thread seat** in `features/threads`: `ThreadSlot`, started with the view's section scope and a `SlotWriter` that holds one thread id, wrapped in `PaneGraph` and `Conversation`. It draws the same thread as the side pane.
- **`<Thread id>`** comes from `@runlith/tagma/ui`; its host module is that seat, on the window's own Svelte.
- **The thread is whole**: composer, tool cards, model picker and every feature contribution. It is the person's interface and acts as the person.
- **A window holding threads** is step 10 of [[d2b5f488]]. Before it, `<Thread>` stands in a section or a pane.

**Rejected:** publishing `@runlith/chat-ui` over `ChatConnection`. Mounted alone, it lacks Tagma's markdown, block references, tool renderers, model picker and uploads, and it would make the kit's protocol a public contract.

### Depth 3: additions to our chat

This also comes after step 5. Each slot's owner declares a face for plugins, in place of `SlotOwners`.
- **Composer parts:** a `composer` point of `views`. A member gets `{thread: {id, projectId, status}, draft: {text, setText, insert, attach}, send}`.
- **Tool cards:** the existing `results` point, drawn as a Svelte view. A card for one of its plugin's own tools gets `{name, input, output, state: running | done | refused, threadId}`. It lands in step 5 of [[d2b5f488]], with the frames it replaces ([[96ba6027]]).
- **Prompt commands:** the `commands` point of `plugins`. A command is text from the manifest, or one of the plugin's actions ([[ba083eb0]]). The composer runs the action through `run_plugin_action`, extended with `{threadId, args}`, and its text answer fills the draft. One handled point therefore serves a key, the palette and a slash command.
- **Pins:** the `pins` point, unchanged.

Every slot keeps three rules:
- its owner shows a plugin's part only in threads of projects where the plugin runs;
- a part's module loads when the plugin is enabled, because feed rows need their geometry synchronously (explanation 8b7128c3);
- each part mounts in its own `<svelte:boundary>`.

A plugin writes no feed entries. Entries decode only installed kinds, which [[a0a16218]] declined to open, and a tool card covers the cases.

**Checks on Tagma's agent's tool calls.**
- **Declaring.** `hooks: [{at, match?, tool, onFailure?, timeoutMs?}]` is a point of `plugins`, which already owns the hook rows and answers, over the points the rule carries. The SDK's `hook()` makes the handler tool `__hook_<name>`, and maps `deny`, `rewrite`, `context` and `block` onto the runner's answers.
- **Calling.** Publication adds a hook in Tagma's format to the same per-project reading that carries command hooks, as a second handler kind: a tool called through the contribution's caller. One rule, one runner and one answer protocol serve every format, and `plugins` never imports `plugin-host`.
- **Matching** happens in the server. Only matching calls leave it, and each one wakes an idle process.
- **Bounds.** A tool hook times out after 10 s unless it declares another timeout. Failure is open by default, and closed per hook with `onFailure: 'block'`. The hooks of one call run at once, bounded by the enabled plugins that match.
- **Reach.** A hook acts in Tagma's own loop: its own threads, and its agent hosted by an outside runner (explanation 8e0f35a1). Under rule [[7a4ff805]] it does not reach a CLI's own tools. The plugin's card says "checks Tagma's agent before it acts — not Claude Code or Codex".

## What is not needed

- **A thread stream to a process.** That is a server-produced `thread.events`, `GET /api/feed/<id>` as NDJSON, heartbeats, and a process held busy by its stream.
  - Every named process use acts on an event — a run end, a question, a tick, a hook — and reads what it needs with `read_thread`. Live text is for a person, who looks through a view that the window serves.
  - Leaving it out keeps idle processes idle, and the server holds no long-lived HTTP stream per plugin.
  - Adding one later is pure addition: an `external` declaration on a feed, and an HTTP feed door.
- **`steer_turn` for plugins:** `start_turn` already joins the run that is going.
- **A model on `create_thread`:** the agent definition and `set_thread_model` cover it.
- **A plugin kind in the agent kit:** the approver stays an opaque address, and the sender an outside name.
- **A plugin approval act:** the plugin answers with `answer_question`.
- **`set_thread_authority` for plugins:** a plugin's thread is born in the mode its birth names.
- **Feed parts from plugins**, plugin-written entries, and a published chat kit.
- **Grants, signatures and install consent** (rule 06e41b6f, and the parent spec).
- **A thread budget per plugin:** the existing thread budget holds.
- **A cap on hook concurrency** beyond each hook's timeout.

## Modules and data flow

**Server:**
- `platform`: the `plugin` field of the `external` actor.
- `invocation`: parsing the plugin caller, the project check, and the `external: 'own'` admission. New relations to `plugins` and `plugin-host`.
- `threads`: the one writer of the binding; `on.asked`; the plugin approver's route, delivery and rerouting; the `threads` point; the transcript entry schema; the HTTP door and `external: 'own'` on `stop_run` and `answer_question`; `own` on `restart_thread`, `continue_thread` and `archive_thread`.
- `native-harness`: `external: 'own'` on `set_thread_model`.
- `providers`: `ask_model`, `read_model_menu`, the ask setting, and the caller on the ask activity.
- `plugins`: the `hooks` point, tool hooks in the per-project reading, and the runner's tool handler.
- `views`: the `composer` point, `results` as a Svelte tool card, and the `transcript` bridge methods.
- `plugin-host`: unchanged. Handler tools are tools, and deliveries are demands.

**Packages:**
- `@runlith/agent`: the `external` inbox sender.
- `@runlith/tagma`: `onThreadAsked` with `leave()`, `hook()`, `models.ask`, the `threads` and `hooks` fields, and `__asked` and `__hook_<name>` with their payloads; in `/ui` from step 5, `transcript(id)`, `<Thread>` and the slot faces.
- `@runlith/chat-ui`: `wordsOf` shows the `external` sender.

**Window:**
- `plugin-views`: serves `transcript` from `ThreadChats` through the one projection, and mounts plugins' slot members.
- `features/threads`: the fixed-thread seat; chat slots take plugin members through their faces.
- `app-plugins`: the card's lines.

```
process ─ POST /api/op, x-tagma-caller: plugin:<id> ─→ admission: actor.plugin · enabled here · own thread ─→ operation
   ↑ supervisor call (wakes it): on.ended · on.asked · hooks · ticks
threads: question → route to the bound plugin → notify ─┘      (failure or withdrawal → the person)
view ─ bridge thread · transcript ─→ window: presence · ThreadChats → one projection
view ─ its own view tools ─→ process ─→ POST /api/op
```

## Cost on every machine

- Admission adds one read of the project's enabled set per plugin call, or of `plugin-host`'s hosted set for a machine call, the same whatever number of plugins is installed. An `own` check reads one thread row.
- A question costs one route lookup in memory, and, when it routes to a plugin, one process call. A registration change reroutes only the open questions of that plugin's threads, through the open-question indexes the reroute already uses.
- A transcript costs what an open pane costs: one chat session. The projection maps only changed entries, and a page is bounded.
- An ask spends on the person's account; nothing is cached.
- A matching hook adds a process round trip to its tool call, and a process start when the plugin is idle.
- Nothing grows with plugins installed but not enabled, and no stream is held open per plugin.

## Order and acceptance

Each check goes through its real caller's door: the SDK's client over `/api/op` for a process, the bridge from a mounted view, the composer for a slash command (rule 571311f8).

**Step 4 of [[d2b5f488]]: depth 1.** Built; listing's section and rail entry wait on step 5's module host ([[96ba6027]]), so until then the card lists a plugin's threads.
1. **Callers and ownership.**
   - A plugin's call naming a project where it is off refuses `plugin-not-enabled`.
   - A thread it creates carries `bindings.plugin` from the caller, and a `plugin` binding in the input refuses.
   - `stop_run` on a thread it does not own refuses; on its own thread it stops the run over HTTP.
   - A turn it sends into the person's thread shows its title in the feed, and the agent reads it as from the plugin.
2. **Questions.** A trainer plugin built on the SDK is installed from a folder and is idle.
   - Its tutor's `ask_user` reaches `onThreadAsked`, which wakes the process. The question is absent from Attention.
   - `answer_question` from the process answers it, and the run goes on.
   - With the plugin switched off in that project, the open question stands in Attention.
   - A delivery that throws sends the question to the person.
   - A handler that answers `leave()` sends the question to the person, into Attention and push.
3. **Models and asks.** The plugin reads the model menu and moves its thread onto another model. `models.ask` with a zod schema answers a typed value, and the card shows that usage with the record's period named.
4. **Views.** A framed view lists the trainer's transcript, shows the tutor's reply as it streams and a tool call while it runs, pages back, and follows a rewind's removal.
5. **Listing.** The trainer's threads stand under its section and not in the general list; with `listed: true` they stand in both.

**Step 6: depth 2.** A section lists merge requests beside a live `<Thread>`. The person sends from it, and the turn is his.

**Step 7: depth 3.**
- A composer part inserts text into the draft, and shows only in projects where its plugin runs.
- A throwing part breaks only itself.
- A slash command runs the plugin's action, and its answer fills the draft.
- A `beforeTool` hook in Tagma's format denies a matching call and wakes the idle process. The same call proceeds while the plugin fails, unless the hook declares `onFailure: 'block'`.

The window of four threads on four providers is step 10, and stays in [[d2b5f488]].

## Not established

Reasoned from the code, not run or read through:
- that `Conversation` draws correctly in a seat without a pane, reasoned from `ThreadSlot`'s arguments.

Not measured: the latency that a process start adds to a hook on an idle plugin.

## Text that follows

When the code lands, these are rewritten: explanations f2afdfd3, b02966b8 and 178c84d6, features 94567243 and 7b731471, and the `plugins` skill (rule 7cb3c1cf).
