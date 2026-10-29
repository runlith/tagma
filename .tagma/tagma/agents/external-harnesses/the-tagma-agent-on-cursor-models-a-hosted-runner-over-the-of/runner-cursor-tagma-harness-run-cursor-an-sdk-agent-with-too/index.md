---
id: 01a16434-fc60-7079-91d8-189eb81e55d7
title: "Runner Cursor `tagma harness-run cursor`: an SDK agent with `tools: ['mcp']` and Tagma tools via `customTools`, the Tagma prompt as a message, the session as `agentId` in the thread store, fork and rewind by journal"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a16400-d245-7390-a63a-e3826255ed3c
  - kind: relates
    to: 01a16437-4c54-7470-ac60-eaf74ff4c780
  - kind: relates
    to: 01a16438-66e6-78c4-8579-22c71ac39bea
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/cli/harnessRun.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/contribution.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/profile.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/vendors/cursor/row.ts
---
The Cursor runner — `tagma harness-run cursor` — is the second hosted runner: the kit's loop adapter ([[050e0330]]) over `@cursor/sdk` local, its ACP profile on the `cursor` harness, and the landing of Tagma agent threads that picked the `cursor` provider model ([[3c947db7]]).

## Landing

- **Who serves the provider.** One owner per transport resolves the thread's provider, model, and account: on ACP landing — the ACP profile declaration (`AcpProfile.serves`); on terminal landing — the terminal argv's model surface (`launch.model`). Today five places read `launch.model`, shared by both transports: `servedBy` (`contribution.ts:18–29`), the core's provider row in `acpKernel` (`birth/seat.ts:35–52`, without it — `EXTERNAL_PROVIDER`), the selection check `askedModelOf`/`chosenModel` (`birth/selection.ts:43–53`, `birth/modelChoice.ts:16–34` — with no surface it refuses any model), the launch account `accountFor` (`sessions/launch.ts:42–53` — with no surface there is no account), and session setup (`protocol/launcher.ts:115–155`, `protocol/alignment.ts:135–147`). All five move to that owner. Claude's answer is the same as today's; on Cursor, ACP landing gets the `cursor` provider, while terminal `cursor-agent` still has no model surface and never gets SDK model ids.
- **The `vendors/cursor/acp.ts` profile.** `argv`: `tagma harness-run cursor` with the model and selection parameters; `hosts: 'tagma'`; `web: 'none'` (Cursor web is off with the built-in tools; the thread gets Tagma's `websearch`/`webfetch` when present); `mode: 'agent'`; `proves.compaction: 'foreign'`; `midTurn: 'after-turn'` (see "Words mid-turn"); `login`: the command is a login on the Providers screen, the code a key refusal; `lockedCode: null`; `sharedSessions: false` (SDK agents and `cursor-agent` chats are different stores, [[16b1a7be]]); `graceMs` 5 s; `extensions`: `_tagma/said`, `_tagma/compacted`, `_tagma/retrying` notices.
- **The terminal `harness:cursor`** is born terminal, as today (`birth/transport.ts:13–25`). Moving a hosted Cursor thread to the terminal is not offered: the stores differ, and `sharedSessions` today only decides the cwd write (`protocol/alignment.ts:47–65`); `set_thread_transport` of such a thread refuses with a typed refusal.
- **Account.** The same landing owner pins the thread's account at launch (above); that account's key is the process environment's `CURSOR_API_KEY` (the launch extension from the provider spec); the runner hands it to the SDK explicitly as the `apiKey` option. Acceptance is the birth of a thread on a Cursor model choice and the launch of the process with that account's key — not a separate `HarnessAccounts.launch` call. An account switch of the thread is a new process on the next turn plus `session/load` of the same session; only a typed not-found on load opens a new session from the journal; an AuthenticationError stays a login refusal, never an automatic retry. Cross-account behaviour of a live SDK with no key is unverified so far.

## The process and the session

- **Process.** Held pipes execution of the execution host, as with Claude: survives a server restart, the driver rereads stdout from the cursor ([[e47bd3fc]]). The SDK loads by lazy `import('@cursor/sdk')` only in that process; under Bun the package serves the flat build (`exports.bun`).
- **The SDK agent.** `Agent.create({ apiKey, model, tools: ['mcp'], mode: 'agent', local: { cwd, store, settingSources: [], autoReview: false, sandboxOptions: { enabled: false }, customTools } })`. `tools: ['mcp']` leaves the model only the MCP family, which `customTools` joins, and switches off built-in tools and `task` subagents; `settingSources: []` (the same as no value) loads no rules, skills, MCP, or hooks of the user's and project's `.cursor`. The user's Cursor environment does not change: a write to `~/.cursor` is a runner defect.
- **Store.** The `JsonlLocalAgentStore` lies in the `store/` folder of the `cursor-sdk/` directory inside the thread scratch. Launch gets scratch through the existing `SessionPlace`, and the profile declaration passes the folder to the process as `CURSOR_DATA_DIR`; existing resource release/eviction of scratch removes it when the thread is deleted and archived. Before its lazy SDK import, the process points `HOME` and `USERPROFILE` at that folder's `home/`, `TMPDIR`, `TMP`, `TEMP` at its `tmp/`: part of SDK 1.0.40 builds paths off homedir and tmpdir regardless of `CURSOR_DATA_DIR`. Families read in the bundled code: the JSONL store and checkpoints; `projects/<workspace>/agent-transcripts`, MCP descriptions, agent-tools, notes, and runtime folders; `~/.cursor/sdk/auth.json` (the key is passed explicitly, browser store:null), plugin/cache and sandbox runtime; temporary bash/PowerShell files. Built-in tools, plugins, and the sandbox are off, but their roots also point into the thread. A full snapshot of the user's `~/.cursor` before and after a live turn is unverified with no key; an SDK update repeats the path reading.
- **Session id.** The ACP `sessionId` = the SDK `agentId` = the thread's `sessionKey`. `session/load` → `Agent.resume(agentId, { apiKey, model, tools, local: { …the same set… } })`: the SDK never keeps `tools` and `customTools` on the agent; they come again. An unknown store or agent is `notFound` (`-32002`), and the driver opens a new session from the journal. A process death mid-turn ends the turn with a failure; the next launch is `load`; the run stuck in the store is dropped with local `force` on the first `send` after `load` (by probe).
- **A new session from the journal.** A non-empty `read_hosted_history` travels as journal messages (kit: text and pictures in their places) before the first prompt: text as blocks, pictures as SDK message `images` (`SDKUserMessage`), each captioned with its journal place; the SDK agent gets no history import. That is how a thread arriving from another provider continues, plus fork, rewind, restore, and foreign compaction; the first turn reads history with no cache, as on a provider switch of a native thread.

## The turn

- **Prompt.** `systemPrompt` is closed for external accounts ([[9fe38a12]]), so the run prompt (`open_hosted_turn.prompt`) travels as the message's first block: in the session's first turn and in a turn where it differs from the last delivered one. The runner keeps the hash in the thread folder after a terminal outcome not marked cancelled, so `load` knows it. After a process death or an unconfirmed cancel the prompt arrives again; that conservatively repeats instructions, never the operator's words. The block is named Tagma instructions replacing the previous ones. Turn context and guidance travel as the next block, as with Claude.
- **Tools.** The profile declares `toolCatalog: 'turn'`: changing the catalog mid-SDK-run is unproven by a live turn. The native preparation owner serves such a thread's admitted tools at once, with no deferred exposure, and the runner pins `read_hosted_tools` into one `send`'s `local.customTools`. Narrowed access still judges the native door on every call. `execute(args, { toolCallId })` goes through the kit relay with the real id; without an id no tool executes. The SDK declares the server `custom-user-tools`; the exact spelling the model writes and the callback-id match with event ids remain a live check. Inline MCP and mid-run reload are not claimed implemented.
- **Message boundary.** `_tagma/said` — after the SDK listed all calls of the model's message (`onDelta` `tool-requests-listed` with the call count, by probe) and before any of their results must return: hosting writes a call result only after that boundary, and the prompt waits for the result.
- **Output.** `onDelta` → kit events: text and reasoning deltas, call start, partial-input snapshots (`tool_call_update.rawInput`, the SDK never gives the raw JSON delta), call end and steps, Cursor's own compression (`summary-started`, `summary`, `summary-completed`) → `_tagma/compacted` with `trigger: 'auto'`, the retelling from `summary` and unknown sizes — the feed shows a compression boundary, Tagma never runs it. Today `_tagma/compacted` requires `preTokens` and `summary` (`protocol/methods/compact.ts:22–27,123–129`) and silently drops a notice without them; the before/after size becomes optional in the shared wire (the kit spec).
- **Spend.** The turn's `usage` message (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`) → the prompt answer's usage. No per-request `usage_update` with `tagma/measured` unless a probe finds each model request's spend (`token-delta`): a Cursor thread's context ring and cache warmth are "unknown", never zero. The turn's price is unknown: local `getUsage` is closed for accounts (`feature_unavailable`), and its records key on usage UUIDs unrelated to `Run.id` (`Run.id` it rejects, bundled 1.0.35 `OZ8`/`FZ8`), with the price arriving late. Linking a turn to a price is separate work for when Cursor opens it.
- **Words mid-turn wait for the turn's end** (`after-turn`), as with Devin. The SDK's `run.steer` answers `revert_to_followup` and, on its own 15 s timer after send, never revokes an already sent word (bundled 1.0.35 and 1.0.40, `steer` → `setTimeout(… 'revert_to_followup', 15000)` before `submitConversationAction`), while a late `complete_delivered` no longer changes the answer. A negative answer never proves the word did not land, and returning the word to the queue would deliver it twice. Steer switches on when the SDK gives a final outcome or a revocation of the handed word.
- **One approval — Tagma's.** The agent has no built-in tools, and `customTools` the SDK registers with an always-yes approval (`HJ8` → `requestApproval: () => ({ approved: true })` in bundled code; the type is "never require interactive approval", `options.d.ts:186–196`); `autoReview: false`, the sandbox off. Only the native door on `call_hosted_tool` decides the thread mode, the rules, and the operator question.
- **Cancel.** `run.cancel()`; hanging `execute` calls answer with a cancel error, the call's server end closes the run; SDK deviations it throws itself at cancel the adapter catches by class in one SDK file; any other unhandled rejection is a process death, never silence.
- **Failures.** SDK error classes → `tagma/failure`: `AuthenticationError` — login; `RateLimitError` and `resource_exhausted` — limit or capacity with a retry on the kernel's rules; `NetworkError` — transport; "Cannot use this model" and `plan_required` — the model is unavailable to the account. `enableAgentRetries` stays on: transport retries sit inside the SDK, the turn never sees them.

## Thread capabilities

| Capability | Value | Why |
| --- | --- | --- |
| law | every-call | Every tool is a Tagma tool through `call_hosted_tool` |
| touch | reads-and-writes | Read and write are Tagma tools |
| authorship | recorded | The record is written by the native door |
| fork, rewind | through the journal | The SDK has no such API; a branch and a rollback build a new session from the journal (first turn with no cache) |
| compaction | foreign | Cursor compresses itself on its server; Tagma's manual and threshold compression runs only on a foreign summarizer with a journal retelling and a vendor-session reset to the fold (the SDK has no compression API of its own). `proves.compaction: 'foreign'` projects into a `foreign` capability next to `core`, `session`, `none`. The menu never offers the thread's provider; the default picks the spendable model of the set chain regardless of cache warmth and its own-model rule, and an empty or non-spendable chain gives `no-summarizer`. A manual step request becomes an end-of-turn request; the threshold is checked after the turn. The automatic mode lives in the inbox with the request. The reset goes through the same `handover.restore` |
| continue | true | Continuing an interrupted turn is a new turn of the same session |
| usage | measured as a turn total | With no context reads on every request |
| aside | none | The SDK has no traceless "question aside"; no automatic recap, a manual one warns of the unknown cache ([[eba592c4]]) |
| pictures | true | `send` takes pictures, and so does a `customTools` result |
| web | none | Cursor web is off with the built-in tools |

Fork without `_tagma/fork` today refuses `harness-contract` (`protocol/opening.ts:123–140`), while rewind without `_tagma/rewind` already builds a new session from the journal. This work gives a hosted profile with no vendor fork the same road for fork: the child opens a new session from its journal. A `history` capability of such a profile allows fork and rewind, though the vendor sessions never do them.

## Delivery

`@cursor/sdk` 1.0.40 is pinned in the server dependencies; the JS is sewn into the CLI bundle with the runner's lazy import, as the Claude Agent SDK is. The platform `@cursor/sdk-<platform>-<arch>` is carried explicitly by `nativeCarried`: with no live turn nothing can prove the context runtime gets by without its `rg`, `cursorsandbox`, and tree-sitter `.node`, even with tools off. Only a probe without the package can remove that carry. Loading from a clean install, a live local turn, and working after Mach-O re-signing stay a separate live check.

## What comes from T3 and what the runner's first build checks

The reference is the Cursor adapter in T3 Code ([[6255ed3c]]): from it come key login and `Cursor.auth.login()`, catalog and parameter projection, `onDelta`-to-turn translation, cancel with terminal-status wait, stuck-run drop after `resume`, failure classes, and known SDK deviations. T3 runs Cursor's own agent, so the parts that make the Tagma agent different went unused in T3 — `tools`, `customTools` and their change per `send`, `steer`, its own store, `resume` from a new process, Bun. They follow the public SDK 1.0.35/1.0.40 types and bundled code and are confirmed by the runner's first live turn at implementation (the implementer's Cursor SDK key). The lines above that depend on them are marked conditional. Measured under Bun 1.4.3 and SDK 1.0.40: a successful import and `AuthenticationError: Invalid User API Key` on `Cursor.me` and `Cursor.models.list`. `Agent.create` with a plainly wrong key returned a local handle with no check — that proves no key; the earlier observation of an early create refusal on 1.0.35 does not carry to this version. No live `send` with a working key and no user-folder snapshot ever happened. What the first build checks:

- the local turn works under Bun; what the platform package must give at `tools: ['mcp']`;
- the model sees only `customTools`; their names; `context.toolCallId` matches `call_id`; the `tool-requests-listed` boundary arrives before `execute` must return;
- catalog change mid-run: `customTools` or inline MCP with `list_changed`;
- `settingSources: []` lets in neither the user's nor the project's `.cursor`; no files write outside the store;
- `cancel` — the delay and the fate of `execute`; `resume` from a new process and after `kill -9`, whether `force` is needed;
- spend — per turn or per request; `getUsage` local;
- who calls itself the model under the Tagma prompt travelling as a message;
- catalog: the context parameter, the look of the reasoning parameter, `maxMode`.

## Acceptance criteria

1. A Tagma agent thread born on a Cursor model choice answers and calls Tagma tools; the feed shows messages, reasoning, calls with diffs, a turn end with spend; the thread row shows the model and rung as on a native thread, the transport unnamed.
2. Every call passes the native door: in review mode the record asks the operator, the path law arrives, row authorship is recorded; through the SDK no file changes and no command launches past Tagma tools (probe: ask the model to create a file without a tool — the disk untouched).
3. Words mid-turn wait for the turn's end and leave as the next prompt; no word is delivered twice; Esc ends the turn `cancelled`, the process stays.
4. A server restart mid-tool-call — the turn continues, the feed with no holes or repeats, the approval question answered; a `kill` of the runner process — the turn ends with a failure, the next word continues the same session (`load`), the model remembers the conversation.
5. Model switch: a native provider → Cursor and back with the same journal; the first turn on Cursor gets the thread's history; a model and parameter switch inside Cursor applies from the next turn, with no new process and no write to `~/.cursor`.
6. Cursor-thread fork and rewind build a new session from the journal; the child continues from the branch point; a picture from the journal reaches the new session's model.
6a. Manual compression of a Cursor thread on a foreign model: the retelling recorded in the feed, the Cursor session reset, the next turn continues from the retelling; the compression menu never offers Cursor models.
7. A snapshot of `~/.cursor` before and after the turn does not change; the store is only in the thread folder; deleting the thread deletes it.
8. The release build on a clean machine: the runner starts from the install, with no user `node_modules`.
