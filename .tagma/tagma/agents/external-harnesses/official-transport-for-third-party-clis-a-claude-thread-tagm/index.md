---
id: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
title: "Official transport for third-party CLIs: a Claude thread (Tagma's own runner over the Agent SDK) or Devin runs over ACP from a held execution-host process, a turn is a Tagma run, transport switches on a stopped thread; Cursor stays on terminal and native"
ord: 19
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses
  - kind: file
    ref: apps/tagma/server/src/threads/contract/service/harness.ts
---
## What the operator gets

A Claude Code or Devin thread can run not only through the terminal (a CLI in PTY plus hooks) but over the vendor's official protocol. Transport is a thread property: `terminal` or `acp`. The default is set per vendor, and on a stopped thread the transport switches.

Cursor is not done on `acp`: by the probes (decision 12) its ACP is poorer than its terminal — no hooks, no model choice and no spend. Cursor stays on `terminal` and `native`.

A thread on `acp` looks and behaves like a Tagma thread, not like a terminal window:

- the feed is an ordinary chat: messages, reasoning, tool calls with diff, turn end and spend, not a TUI screen;
- permission requests and agent questions arrive as Tagma questions with their own options, with no screen parsing;
- operator and agent words are delivered exactly once, and the agent's answer to the request proves acceptance, not the screen;
- interrupt and stop are protocol acts, not synthesized keys;
- a turn survives a Tagma server restart just as the terminal path survives it today.

## Decisions

### 1. One wire — ACP v1; vendor-specifics in the vendor profile

Tagma's official transport speaks only ACP v1: stdio, NDJSON JSON-RPC, `protocolVersion: 1`, schema 1.24.1 ([[ce4ad67e|ACP versions]]). This is the only protocol officially given for embedding by both Cursor (`cursor-agent acp`, documented as "for custom clients and integrations") and Devin (`devin acp`, in the ACP registry and Cognition docs). For Claude this protocol is given by Tagma's runner over the Agent SDK (decision 2). In the nightly matrix of the registry 34 of 35 agents answered `initialize`, and all 34 with `1` ([[2eb4e347|ACP registry]]). v2 is still a draft, and no agent speaks it; Tagma does not support v2 until some needed agent declares it.

Vendor differences sit in the vendor profile — the optional `acp` field of the `vendors/<vendor>/row.ts` row, not in driver branches. The profile declares:

- launch;
- the permission mode;
- translation of the chosen model into the agent option;
- how to take words mid-turn;
- readable extensions;
- what this vendor's hooks prove in ACP mode.

An extension off the spec (`_session/steering`, `cursor/*`, `_cognition.ai/*`, `_claude/*`) is read only if the profile declared it and the agent declared it in `initialize`. Without that the driver behaves as if the extension does not exist. An unknown update does not break the turn. The driver counts such updates in memory by method and writes the first sample and their count into diagnostics once per turn.

Rejected:

- **A transport per vendor:** `@cursor/sdk`, Devin cloud API, `--output-format stream-json`.
  - Cursor SDK is proprietary, login is API key only, it has no approval callback, `tool_call` bodies are unstable ([[1249b48f|Cursor surfaces]]).
  - Cloud Devin runs in a VM, not in the local tree ([[8e9a1ff3|Devin surfaces]]).
  - Cursor's `stream-json` gives a process per turn per the docs, with no thoughts; the docs name no usage or permissions. It was never run live.

  A vendor's own transport stays a candidate only where a measured ACP gap is closed by it alone. Then it is a new profile under the same driver contract.
- **Session multiplex in one agent process.** Decision 3 keeps one process per thread.

### 2. Claude: Tagma's own runner over the Agent SDK in its own process, Tagma's wire to it — ACP

Claude runs on the official Agent SDK (`@anthropic-ai/claude-agent-sdk`). The SDK lives not in the Tagma server process but in Tagma's runner — a separate process held by the execution host (decision 3). From outside the runner is an ACP agent: one Tagma driver for Claude, Cursor and Devin.

**Goal — a Claude thread on `acp` nearly indistinguishable from a native Tagma thread.** Claude Code gives only the agent loop and user input. Everything the agent sees and acts with is Tagma:

- **Thread hosting.** Everything a native agent gets from its run, the Claude thread gets from one server-side owner — `ThreadHosting` in `packages/agent`, via `read_hosted_agent`, `open_hosted_turn`, `call_hosted_tool` operations. The owner builds from native owners: the run prompt, context, `beforeStep` policy (law, path touch, `$skill`, delegation, MCP exceptions, gating skills) and the catalog with the same tool door. The thread remembers which native agent it hosts.
- **Prompt.** `systemPrompt` is the frozen thread prompt, as on a native run: `pendingSystemPrompt` applies on run capture. The `claude_code` preset is not used. When the prompt changes on a run boundary, the runner reopens the query (resume of the same vendor session) — the new prompt goes from the next turn. Claude Code freezes the prompt on resume by default ([[6c4c410f|SDK-on-Bun probe]]); the runner turns this off with the documented SDK option `systemPrompt: { type: 'custom', prompt, snapshot: false }` ([[4acce69d|Claude runner]]). To Tagma's prompt Claude Code itself adds a billing block and a line that the agent is built on the Agent SDK, and reminders of environment, model, account email and date into the first message; that stays.
- **Tools.** Claude Code built-ins are off via the `tools` list, keeping only the vendor's `WebSearch` and `WebFetch` (they replace Tagma's `websearch` and `webfetch`, which the runner does not publish; `WebFetch` asks Tagma via the `PreToolUse` hook); `disallowedTools` won't do for this — dozens of built-ins slip through it ([[e23e83c7|tools and settings under the SDK]]). The agent gets the native agent's Tagma tool catalog without `websearch` and `webfetch`: `read`, `edit`, `write`, `bash`, `grep`, `glob`, graph operations and collaboration. The runner holds an in-process SDK MCP server (`type: 'sdk'`) that only forwards calls to `call_hosted_tool` with the thread's grant; `strictMcpConfig` cuts off everything else. Before every prompt the runner opens the hosting turn and sends `tools/list_changed`, and Claude re-reads the catalog. The call runs on the server in the thread run's world, as on a native agent, with the run signal (interrupt and stop end the call), so the same door as in the native thread writes law, path touch, line authorship and the change record. Media from tool results reach Claude as images.
- **Skills, CLAUDE.md, user settings, auto-memory.** `settingSources: []`, Claude Code skills off. The agent gets Tagma skills the same as a native one. Claude Code auto-memory (`~/.claude/projects/<cwd>/memory/MEMORY.md`) is off via the `autoMemoryEnabled: false` setting in every query: `settingSources: []` does not close it, and the thread needs no second memory next to the graph that Tagma cannot see.
- **Feed, questions, delivery, interrupt, fork, rewind** — as in the native thread (decisions 6, 7, 10).

- **Compaction** is done by Claude Code itself, in the same session, over SDK, on a warm cache. The runner sends `/compact` into the session with Tagma's retelling instructions. Claude Code compacts history itself and continues the same session. Tagma only decides the moment — by context fill from each turn's `usage`, as in the native thread — and writes the boundary (`compact_boundary`) and retelling into the feed with the same compaction record as the native thread. Claude Code's own auto-compaction, if it fires first, yields the same feed record.
- **Provider switch** — as in the native thread (decision 11).

Only the inner model-and-tool loop of one turn stays with Claude Code.

Why not the SDK in the server: the SDK's `query()` is an object in the calling process's memory. The SDK inside the server dies on every Tagma restart together with the going turn. The terminal path survives a restart because the execution host holds the PTY.

Why its own runner, not the ready Zed adapter (`@agentclientprotocol/claude-agent-acp`, [[84bfc57a|adapter reading]]):

- **Its own prompt and tools.** The adapter sets the Claude Code preset and its tools; the runner hands the agent Tagma whole.
- **Everything from the SDK.** The runner takes from the SDK everything Tagma needs, including what the adapter does not carry through: `resumeSessionAt`, interrupt receipts, `replay-user-messages` echo with send uuid.
- **No third-party package** between Tagma and the SDK that may lag behind new Claude Code versions.
- **Less code.** The runner needs a subset of the adapter's tasks: one thread — one process, no AIR, no file and terminal client methods, no shared options for arbitrary clients.

The Zed adapter is a reference: it lends the knowledge of how it solves already debugged subtleties. That is translating SDK events into ACP updates, steering with result wait, `canUseTool` translation, fork and resume. The runner code is written in the Tagma style.

What the runner does:

- **Session.** Holds one long-lived `query()` with streaming input (`AsyncIterable<SDKUserMessage>`), `includePartialMessages` and `replay-user-messages` echo. `claude` is the user-installed unmodified binary (`pathToClaudeCodeExecutable`).
- **Protocol.** Answers ACP v1:
  - `initialize`;
  - `session/new`, `session/load` and `session/resume` — via SDK `resume`/`forkSession`;
  - `session/prompt`;
  - `session/cancel` — via `Query.interrupt()`;
  - `session/set_config_option` — `model` and `effort` via `setModel` and flags;
  - `session/set_mode`.
- **Updates.** Translates SDK events into ACP updates: text and reasoning, `tool_call`/`tool_call_update` with diff, `usage_update`, and the `result` outcome into the prompt answer with `stopReason` and spend.
- **Mid-turn words.** Takes them via the `_tagma/steer` extension. It is an `SDKUserMessage` with priority `now`, and while awaiting permission — `later`. Confirmation is the echo with this send's uuid: exact acceptance, not a heuristic.
- **Law, touch, authorship.** The server writes them on the Tagma tool execution, as in the native thread. The session runs `bypassPermissions`: Claude Code tools are off except `WebSearch` and `WebFetch` (Tagma's `PreToolUse` hook is asked about `WebFetch`), and Tagma judges its own tools itself. The runner needs no SDK callbacks hooks for this.
- **Orientation.** Enters its own `systemPrompt` (decision 5).

Project file hooks do not fire in the runner session: `settingSources: []` does not load them from settings. P1 checks this.

The runner is the `tagma` verb (`tagma harness-run claude`) declaring the `external-harnesses` manifest. It is launched by the Tagma runtime (Bun) from the same install. No separate layout part and `npx`. The SDK is a pinned Tagma dependency, with no optional binary. Whether the SDK runs under Bun is checked by P1.

Rejected:

- **SDK in the server process** — the turn is lost on every Tagma restart.
- **A ready Zed adapter as the Claude process** — hooks file-only, part of the SDK unreachable, Tagma depends on another package's release pace.
- **Adapter fork** — someone else's whole code would need maintaining, including what Tagma does not need.
- **Its own protocol instead of ACP** — a second driver next to the Cursor and Devin ACP driver. What the standard lacks, the runner adds as `_tagma/*` extensions.
- **Its own implementation of the `stream-json` control protocol against the binary** — it is the SDK's inner wire to its own CLI, not a published contract.

### 3. The agent process — a held pipes execution; input via the harness lane

Each thread on `acp` is one agent process: `cursor-agent acp`, `devin acp` or the Claude runner. `Terminals.start` launches it with `transport: 'pipes'`, `lifetime: 'held'` and the same environment as the terminal launch: `harnessPlace` (the thread's signed grant via `sessionTokenEnvironment`), model variables. The execution host holds the process and journals stdout and stderr.

Input goes the same as on the PTY path: via the harness lane (`HarnessLanes`, `writing.openBinding` on the `harness` road, then `writing.input` with text). The lane reopens after a server restart under a new binding. The lane keeps the sequence and admitted acts in memory, so a lost host answer recovers under its own sequence only within one server life. Across a restart the acceptance receipt in the driver row proves it (decision 4). Held stdin (`stdinHeld`) does not fit: `Terminals.start` allows it only to an internal, call-lifetime launch, and it dies with the launching scope. Whether the host writes text into a held pipes execution via a lane is the first thing the driver task checks. If not, the `executions` owner fix enters the same task.

One process per thread was picked thus:

- ACP gives no per-session environment except `mcpServers[].env`/`headers` and `_meta` ([[19b0dc5f|what the client gives the agent]]);

- with a process per thread, the process environment is the thread environment, and the grant reaches the agent's children — the `tagma` MCP servers and `tagma hook` processes — the same way as in the terminal.
That the grant reached the children is measured only for stdio MCP under the Agent SDK and the Claude adapter ([[07a7739c|SDK probe]], [[19b0dc5f|what the client gives the agent]]). For Cursor and Devin that is probe P2, for hooks — P3. On the Claude runner, callbacks hooks take the grant from the runner process's own environment. The price is a process per thread, as on the terminal path. Pipes are cheaper than PTY: the host's screen parser does not run on them.

### 4. Codec, driver state and restart

The codec is `@runlith/ndjson-rpc`, which already reads `codex app-server` over the same `ExecutionRecords.records`. Today it holds one pending request and counts a frame with `id` and `method` as corrupt. It is extended with two-way exchange:

- agent-to-client requests;
- many pending requests;
- externally issued ids;
- primary parsing of only the envelope: `id`, `method`, presence of `result` or `error`.

A line up to 1 MiB (today's `LINE_CAP`) parses on the loop. A longer line, up to the ceiling, is parsed by the framing owner's worker, by the heavy-computation rule.

The driver sets the line ceiling, not `ndjson-rpc`: it is this thread's stdout hold (`output.retainedBytes` of the host policy). A longer line cannot be guaranteed read whole: a lagging reader loses its start on eviction. A line past the ceiling is a typed turn failure, and framing does not accumulate its bytes.

Today's `JsonRpcExchange.request` API with one pending request serves `sessions/prepareRoot.ts`. The extension keeps it, not breaks it. The `src/exchange.ts` entry of the ndjson-rpc module opens to the new kit (`set_module`).

The `packages/acp` kit holds:

- Effect Schema of the ACP v1 subset Tagma reads;
- a pure client machine: frame or intent in, frames, projection events and new state out.

There is no second line codec. `ClientSideConnection` from `@agentclientprotocol/sdk` is not taken: its request map lives in memory, and Tagma needs one restored from the record.

The driver state is its own `external-harnesses` row, per thread; thread facets do not hold it. The row holds:

- the stdout cursor with the execution key it belongs to. The cursor is valid while the key equals `ExternalSession.execution`. The process names the facet: it alone owns this fact;
- the id counter;
- Tagma's pending requests: id → meaning (prompt with delivered envelope ids, cancel, load, set_config_option, set_mode) and the host's acceptance receipt (`InputAdmitted`) when it arrived;
- the stop grace deadline of the going stop;
- the agent's pending requests: id → Tagma's question or answer.

The vendor session id is not this row's field but `ExternalSession.sessionKey` and `observation.binding.rootKey`, as on the terminal path: hooks are admitted against `rootKey`, resume reads `sessionKey`. The driver also writes `observation.work`:

- `working` — from the prompt record to its answer;
- `waiting` — while a protocol question stands in the slot;
- `idle` — after the answer. Observation describes the protocol state; thread activity on `acp` comes from the core run, as [[5c2a4c31|ACP activity source]] explains. Unknown observation counts as working only on `terminal` ([[fe977076|terminal CLI projection]]).

Records go in this order:

- **Before bytes.** Tagma's request is recorded in the row before its bytes are written, in the same machine record as the inbox envelope reservation. The host's acceptance receipt is appended after `InputAdmitted`. A request with no receipt becomes uncertain on restart, as on a record break: Tagma does not resend it, and the turn does not wait for an answer that may never come.
  - If the host refused the write, the envelopes return to the queue.
  - If the work is uncertain, `observation.work` becomes `unknown`. An agent request's answer is also recorded before bytes. An answer whose record is unknown is resent only if P3 shows the agent drops answers to an already closed id. Otherwise the agent request stays uncertain.
- **Ids.** String, with the incarnation of the process in the prefix, so they collide neither across a server restart nor across a new process.
- **Projection.** The stdout cursor advances in the same machine record as the frame projection into the feed (decision 6), and only on boundaries: tool call start and end, question, turn end. Repeat processing after a failure starts from the recorded cursor and yields the same result. Its cost is bounded by the bytes since the last boundary.

After a server restart the agent process is usually alive: the host holds it. Then the driver reads stdout from the cursor, gets answers to its requests and answers the agent's pending requests it read from the same journal. The turn continues — this is reading live output, not session replay.

If the host evicted bytes past the cursor (`retainedFrom` past the cursor), the read answers with a break. The driver:

1. writes a break record into the feed;
2. skips to the first whole line;
3. marks all pending requests of both sides uncertain.

An uncertain prompt leaves its envelopes delivered without confirmation. The driver gives a late answer the profile's grace, checked on heartbeat by monotonic clocks; if the answer never arrives, the process closes and the turn ends in failure with no word repeat. The next words may start a new run. Tagma does not answer an uncertain agent request at random.

An answer arriving later for an uncertain id closes that request in the ordinary order. For example, an answer to `load` after a replay that itself ran into the hold.

If the process died (host replacement, agent crash):

1. the going turn ends in failure with "agent process died";
2. pending requests close;
3. unconfirmed deliveries stay unconfirmed;
4. cursor and counter reset with the new `ExecutionRef`.

The next start raises the process and continues the vendor session: `session/resume` where the agent declared it, otherwise `session/load` — Cursor and Devin have only `load` ([[904cee6b|Devin probe]], [[3632e800|Cursor probe]]). History replay on `load` is drained without schema parsing: framing and waiting for the `load` id's answer. It is not projected into the feed, because Tagma already recorded the feed. On the Claude adapter the replay shape is measured as folded ([[01013b02|turn flow]]); on Cursor and Devin its shape is unmeasured, but that does not matter because the replay is not read.

The driver holds the session lease the same as the PTY driver: `session.heartbeatAt` with the `LEASE_RHYTHM` rhythm. Without it another server's `claim` would count the session as ownerless. This is a heartbeat-only record, and `HarnessSessionStore.change` does not publish it.

### 5. Hooks in ACP mode: what stays with them, what moves to the protocol

The installed terminal-path hooks are not only law. On the terminal path they carry:

- word delivery: Stop → `stop_harness_turn` → followup;
- the parent report: `answer_harness_turn`;
- questions: `judge_harness_call`, `PermissionRequest`;
- work state: `report_harness_event`;
- input confirmation: `UserPromptSubmit`.

In an ACP session the same hooks fire next to `session/update` ([[9ff45955|ACP vs hooks]]). Without role split there would be two delivery, report and question mechanisms.

Server owners decide, not the `hooks/door.ts` door: it runs inside the `tagma hook` process and holds no facet. Each owner already reads the thread, and for `acp` looks at the transport:

- `turns/deliveries.ts` `followup`;
- `turns/hookAdmission.ts` `reported`/`answered`, where `confirmInput` and `observations.accept` stand;
- `asks/decision.ts`;
- the `report_harness_event` receipt (`hookAdmission.reported`), by which the hook client decides whether to orient. The `session_start`/`first_prompt` answers themselves belong to `graph` and know no transport.

On `acp` the roles split thus:

| Role | Source on `acp` |
| --- | --- |
| Path touch (`touch_path`) and line authorship (snapshot on `PreToolUse`, `record_write` after) | on Claude — the server on the Tagma tool execution, as in the native thread; on Cursor and Devin — the hook, if the profile declared hooks fire in ACP mode |
| Law before writing | protocol: Tagma's judge judges `session/request_permission`; the `PermissionRequest` hook stays silent |
| Start orientation | always the first `session/prompt`. The `reported` receipt on `acp` tells the hook client to print neither the `session_start` output on `SessionStart` nor `first_prompt` on the first prompt. The source is one and does not depend on whether `SessionStart` fires under the SDK ([[07a7739c|SDK probe]]). |
| Word delivery, followup on Stop | protocol; `followup` answers "nothing to deliver" |
| Turn end and parent report | protocol (`stopReason`); no hook report is written on `acp` under any arrival order |
| Input confirmation | protocol; `UserPromptSubmit` takes no part in delivery |
| Work state | protocol |

One fact is never written from two sources. Where hooks do not fire in ACP mode, the profile declares weaker:

- a write is visible from `tool_call` (`kind: edit`, `locations`, `diff`) and is written by observation, not by work;
- path touch on read is not delivered at all, because ACP does not intercept reads.

Weakening shows in the thread row. A thread with weakened law is not passed off as a thread with full law.

Law before writing. In the terminal the judge (`judge_harness_call`) fires on the CLI's permission request — the `PermissionRequest` hook, on Cursor `beforeShellExecution` — not on every call. On `acp` the same moment is `session/request_permission`. So:

- **Session mode.**
  - On Claude — `bypassPermissions`: Claude Code tools are off except `WebSearch` and `WebFetch`, and the server judges Tagma tools, as in the native thread (decision 2). `request_permission` arrives on Claude for one `WebFetch` only: the runner asks it as that vendor's question.
  - On Cursor and Devin — the vendor mode that asks about changing calls; P3 picks it. Their bypass mode (`bypass` and the like) is never set on `acp`: it would remove the only judging point.
- **Call for judging.** `request_permission.toolCall` translates into `HarnessCall {tool, subject}`, as `subjectOf` does for hook payloads. The projection shared by the driver translates ACP `kind` into the judge's dictionary (`KINDS`, `MUTATES`):

  | ACP `kind` | For the judge | Mutates |
  | --- | --- | --- |
  | `read` | read | no |
  | `search` | grep | no |
  | `fetch` | fetch | no |
  | `edit`, `delete`, `move` | write | yes |
  | `execute` | bash | yes |
  | `think`, `switch_mode`, `other` | other | per profile |

  The subject comes from `rawInput`, else from `locations`, else from `title`. On Gemini, for example, the request has no `rawInput`. The profile may refine the projection for its tools.
- **Judging.** The judge splits into verdict and question parking. The verdict is `permissionOutcome` under the thread's mode, as today. Parking puts a question with the `protocol` source. Today's `judge` parks a `hook` question and stays silent while a question stands; for the protocol that won't do.
- **Verdict with no rule** (today's `Unspoken`: the thread mode allows) — `allow_once` at once, with no operator, as in the terminal.
- **A rule needing the operator** (today's `Asked`) — a question into the queue (decision 6). The operator's "allow" answer yields the `allow_once` option, "deny" — `reject_once`, and where it is missing — `reject_always`. The judge decides later requests while the earlier question hangs.
- Tagma never picks an option with `allow_always` kind: the agent would record such a rule with itself, outside Tagma. If the agent has no fitting option, the question shows the operator all of the agent's options.

On Cursor and Devin a call the agent allowed itself under its own mode or rules never reaches Tagma. On Claude every call is a Tagma tool, and the server judges it, as in the native thread. The terminal path launches the CLI in bypass mode, and whether `PermissionRequest` fires there on Claude is unverified. So `acp` judges no fewer calls than the terminal, and on Claude — every call.

MCP and hooks are the same installs the terminal path puts into the project: vendor hooks (`.claude/settings.json`, `.cursor/hooks.json`, `.devin/hooks.v1.json`) and the `tagma` server declaration (`installs/mcpDeclaration.ts`). The grant comes from the process environment.

- **Probe P2 hypothesis:** in ACP mode the agent reads project configuration like the interactive CLI. So `session/new.mcpServers` is empty: otherwise the `tagma` server could rise twice. This is unmeasured.
- **If it does not read,** the profile passes the server in `mcpServers` from the same declaration. For that `mcpDeclaration.ts` exports the declaration value (command, arguments, environment) and the ACP shape `{name, command, args, env:[{name,value}]` next to the vendor file shapes.

The vendor's user configuration — its skills, MCP, settings — loads in an ACP session too, as in the terminal ([[3632e800|Cursor probe]], [[904cee6b|Devin probe]]). Tagma does not isolate it. Changing the user's global state is forbidden instead (decision 8).

Orientation — what the terminal thread gets from `session_start` — and the `thread-teams` law travel in the first `session/prompt` as a separate content block. On Claude orientation and law are part of Tagma's own `systemPrompt`, assembled as on a native agent (decision 2).

### 6. Feed: an ACP turn is a Tagma run

On `acp` one Tagma run is one turn:

- **Start:** the `session/prompt` record, to which delivered envelopes bind (`deliveredToRunId`).
- **End:** the agent's answer to that prompt with `stopReason`. On it `ReportEmitter.turnAnswered` sends the parent report.
- **Process** — `ExternalSession.session`, as on the terminal path. `ThreadRuns.current` points to the going turn on `acp`, not the process.

Today's consumers that key the run by process move to the turn id on `acp`:

- `ReportEmitter.turnAnswered` and `HarnessDeliveries.answered` → `inbox.answered(threadId, runId, …)`: on `acp` `runId` is the turn id, otherwise the answer finds no delivered envelopes and the parent report never leaves. The report envelope id `envelope:report:${request}:${run}:${turn}` and `harnessAnswerReport` take the same turn id;
- `ReportEmitter.sessionEnded` — a filter `deliveredToRunId === session.id`. A process death mid-turn sends the parent a report about that turn;
- `ReportEmitter.asked` — `deliveredToRunId === question.sessionId`. A protocol question carries the turn id in its own `runId` field; `sessionId` of the question means the process on `acp` too;
- `roots.settleInput` — `inputPending(threadId, sessionId)`;
- `withExternalRuns.running` in `threads/harness/collaboration.ts`, which knows only `held.kind === 'session'`. `HarnessCurrent` gets the going turn.

The `threads` owns the thread feed. So `threads` declares the external-harness turn-record port (`contract/service`):

- turn start with words;
- boundary records;
- turn end with spend;
- live deltas into the live feed with no database record.

Records are the same journal kinds a native thread writes: message, reasoning, tool call, question, interrupt, failure, run end with spend. The record goes through the thread transition with CAS by version, as `threads/mergeNotice.ts` does. If the run end with spend needs the native aggregate's lifecycle, the port goes through that aggregate's transition, not through a second writer. Today the external-harness thread's consumer writes no journal events (`folded: () => Effect.void`). On `terminal` it stays that way.

`session/update` projection:

| ACP | Record |
| --- | --- |
| `agent_message_chunk` | message (chunks collapse into one record) |
| `agent_thought_chunk` | reasoning |
| `tool_call` / `tool_call_update` | tool call: `toolCallId`, `kind`, `status`, `rawInput`, `rawOutput`, `content` including diff |
| prompt answer | run end: `stopReason` and spend where the agent gave it |
| `session/request_permission`, `cursor/ask_question` | question |
| `cancelled` | interrupt |
| error answer, process death, record break | failure |

The call record is also created from a permission request: Gemini, for example, declares the call only inside `request_permission` ([[01013b02|turn flow]]). `Harness.spent` on `acp` answers the sum of the turns' spend where the agent gave it, and names unmeasured turns.

Agent questions: several permission requests may stand at once (parallel tools), while the facet has one question slot (`question`, the `choice` kind). The agent's pending requests stand in the driver row. Into the `question` slot comes the oldest first, with a new `protocol` source next to `hook` and `screen`. `Harness.answer` and `cancel` are routed by `contribution.ts` on the facet question source: `protocol` goes to the driver, the rest — to `HarnessPermissions`, as today. So `harnessPermissions` does not depend on the driver, and the driver depends on the judge, with no build cycle in `assembly.ts`. Elicitation (`clientCapabilities.elicitation`) is not declared by Tagma: Tagma's question is choice-only for now. The Claude runner turns `AskUserQuestion` off (`disallowedTools`) while Tagma's question is choice-only, and the agent asks in text.

An agent's stderr is failure diagnostics, not feed.

### 7. Delivery, interrupt and stop

The [[a6cf58e6|once-only delivery]] semantics stay, but the agent's answer proves acceptance:

- **Agent free.** Ready envelopes become one `session/prompt`: a framed block per envelope, as on the terminal path.
- **Turn going.** The profile declares how to take words mid-turn:
  - `steer` — `_tagma/steer` on the Claude runner; on an agent that declared `_session/steering` — that one;
  - `queue` — the agent itself queues the prompt (declares `promptQueueing`);
  - `after-turn` — Tagma holds envelopes until `stopReason` and sends the next prompt.

  A second `session/prompt` during a turn with no declared queue is never sent: by the sources, Gemini cuts the going turn with it. `after-turn` is safe on any agent. Cursor and Devin stand on it: a second prompt cuts the going turn on both ([[75d8d1d1|Cursor turn]], [[4c350a0c|Devin turn]]).

On Claude priority `now` cuts the turn in milliseconds and launches the word as the next turn, `later` waits for the turn end ([[b05a4728|mid-turn words and interrupt]]). On native, steer inserts the word on a step boundary without cutting work. The runner first measures priority `next`: if it inserts the word on a step boundary, the Claude profile steers through it. Otherwise Claude stands on `after-turn`, and only an explicit interrupt cuts. On Claude acceptance confirmation is the `isReplay` echo with the send uuid: it arrives when Claude Code started handling the word.
- **Delivered, unconfirmed.** The host took the stdin record — envelopes delivered without confirmation. Update start after the record is work's witness, not confirmation's.
- **Confirmed:**
  - the result answer to this prompt's id arrived;
  - or `_session/steering` returned `injected` or `startedNewTurn`.
- **Not taken:**
  - error on the prompt id before this turn's first update;
  - `_session/steering` returned `promptRequired`.

  Envelopes return to the queue with their reason. An error after updates start is the turn's failure, and the words stand taken.
- **Uncertainty.** A lost host answer and a record break are uncertainty: no auto-repeat, the sender sees "unconfirmed".

`interrupt_agent` on `acp` is `session/cancel`. Tagma answers `cancelled` to all this turn's standing permission requests. The turn ends `stopReason: cancelled`, the process stays. The `receive` branch for the `interrupt` task goes to cancel, not stop.

`stop_agent` and `Harness.stop`:

1. `session/cancel`;
2. waiting for `stopReason` within the grace;
3. `session/close` where the agent declared it;
4. process end via the host.

`Harness.end` (retire) is the same, and the facet goes to rest. A turn killed without cancel ends in failure, not `cancelled`.

The profile declares stop grace.

- Measured: `Query.interrupt()` on Claude gives `result` in 17–25 ms, `cancel` on Cursor in 3–11 ms, on Devin in 10 ms. All three profiles' grace is 5 s: two orders above measured, with room for a slow machine and a tool that does not end at once. A hung MCP tool under interrupt is unmeasured.
- The grace deadline is recorded in the driver row. After a server restart the driver reads the deadline and either waits it out or at once ends the process via the host, so the stop never sticks in `stopping`.
### 8. Model, login, side effects

The model is set at session or process start the way the profile knows:

- **Claude** — the runner declares `configOptions` `model` and `effort` and applies them via `setModel` and SDK flags. It does not touch the user's global files.
- **Devin** — `--model` on `devin acp` and `set_config_option` `model`/`thought_level`; both work and show in `turn_stats` ([[a9546793|Devin model]]).

The model catalog is Tagma's provider rows (`askedModelOf`). The profile translates the choice into the agent option's value and refuses if the session's `configOptions` has no such value.

Login:

- Tagma does not touch credentials: the agent takes its own CLI's kept login.
- No login (`auth_required` or `terminal`-type `authMethods`) is a typed `harness-login` refusal with the login command: `agent login`, `devin auth login`, `claude auth login`.
- What agents answer to an exhausted quota and to 401 mid-turn is checked by P5. The refusal names the agent's reason.

The profile does not change the user's global state: known calls that write user files outside the project are never sent by the driver. That is Cursor `set_model` and Gemini `authenticate`.

### 9. Transport switch

- **Setting.** `threads.harnessTransport` — a vendor → `terminal | acp` map, scoped like the other thread settings. Birth `harness:<vendor>` takes its value from it. A vendor with no `acp` profile is born on `terminal`. Transport is recorded in the facet (`ExternalSession.transport`; the kept-facets migration step sets `terminal`).
- **Operation.** `set_thread_transport` switches a thread's transport that has no standing process. A resting terminal CLI (`harnessSessionAtRest`) won't do for `unknown`: in `unknown` work it does not tell a turn from idle ([[fe977076|terminal CLI projection]]). A live process also holds the vendor session: on Devin `isLocked`/`lockHolderPid`. So a thread with a process gets the `thread-running` refusal with the way out "stop_agent, then again". An ended session that still owes the parent a report (`state: ended`, `reported` not set) gets the `session-reporting` refusal, as `HarnessSessionStore.open` does: it is reported by the driver that led it. The right is the same as `set_agent_model`'s: the operator or the thread's parent.
- **Inbox.** Envelopes reserved for the old session but undelivered return to the queue. Delivered-but-unconfirmed ones stay so.
- **Vendor session.** The next start continues the same vendor session (same `sessionKey`) where session storage is shared; the profile declares `sharedSessions`, and probes check it:
  - Claude — the same `~/.claude/projects` JSONL; continuation via SDK `resume` in the runner — P1;
  - Devin — `session/list` sees the interactive CLI sessions ([[904cee6b|Devin probe]]). The `cwd` filter compares literally (`/var` vs `/private/var`), so the driver passes the real path;

  Where storage is not shared, a new vendor session starts with a thread recap. Recap is context carry, not delivery. It travels as a framed block naming itself the thread's history before the transport switch, not an instruction. Inbox envelopes go after it in their order.
- **No handover between drivers.** There is none: transport switches only while no process stands, and a driver watches the thread only while its process stands. `HarnessSessions` reads transport from the facet on every call.
- **Feed.** It does not break, and the transport-switch record stands in it in its place.
- **Out of this work** — moving to and from `native`: that is a harness change, not transport.

### 10. Fork and rewind

**Claude — in the first version, via the official SDK API.**

- **Fork** — `resume` with `forkSession: true`: a new vendor session, the original unchanged.
- **Rewind** — `forkSession` together with `resumeSessionAt: <message uuid>`: a new vendor session continues from that message, the original unchanged, and the thread gets a new `sessionKey`. `resumeSessionAt` without fork appends a branch into the same session file; that variant is not used ([[30b86b6d|resume, fork, rewind, compact]]).

The runner declares both operations as `_tagma/fork` and `_tagma/rewind` extensions. The Tagma turn id travels in every prompt (`_meta['tagma/turn']`) and serves as the SDK message uuid, and the answer returns the first and last message uuids of the turn. So the Tagma turn and SDK messages bind with no separate map.

Fork "whole history" and "to turn" and rewind "from turn" go through the vendor session prefix. Fork "last N turns", single-turn delete and restore have no prefix: the runner opens a new vendor session assembled from the edited Tagma journal, the same way as the `native` → `acp` provider switch (decision 11).

Tagma `fork` and `rewind` operations over a Claude thread on `acp` do two things in one act:

- call the runner;
- copy or cut the thread feed at the same point.

Fork births a child thread with its own `sessionKey`. Rewind cuts the feed at the Tagma turn. Conversation and feed roll back, not the tree files: tree files are rolled back by whatever rolls them back in the native thread.

A thread's `fork` and `rewind` capabilities come from the profile. The facet gets them in the `proves` snapshot at birth and on transport switch, and `threads` reads them from there instead of the `EXTERNAL_CAPABILITIES` constant. Before birth, on the agent-type offer, the constant stays.

**Devin — a separate task.** Its `session/fork` and `session/resume` answer `-32601` ([[904cee6b|Devin probe]]). Fork and rewind are possible only through its on-disk session storage, which is still unstudied. The format is inner and undocumented. The profile declares fork and rewind only while a probe of its CLI version confirms the format. On another version the operation refuses with a type and names the version.

### 11. For the user, a Claude thread over SDK is an ordinary Tagma thread

The user does not think about transport: where what is possible, where not. A Claude thread on `acp` looks and behaves native, including switching the model to any provider.

- **Model choice.** Claude models running through the runner stand in the same model choice as all the rest, with their account. Transport is a provider-row detail, not a user choice.
- **Provider switch both ways.** `set_agent_model` and the chat model picker move a thread between the Claude runner and the native harness with any provider, the same as a native thread switches provider today. The Tagma journal is the source of truth:
  - **`acp` → `native`.** The native harness continues from the thread journal. In the SDK thread prompt and tools are Tagma, so journal records are the same as a native thread's. Signed Claude reasoning is dropped, as on a native provider switch.
  - **`native` → `acp`.** The runner gets history from the Tagma journal. The exact path is a Claude Code session file assembled from the journal, plus `resume`. If the installed Claude Code version does not take it (a shape probe on every version), the runner starts a new session with recap. The user sees one and the same feed in both cases.
- **Price.** The first turn after a provider switch reads history with no cache — as on a native provider switch today.
- **Thread capabilities.** `modelMove`, `compaction`, `fork` and `rewind` are on for a Claude thread on `acp`.

### 12. Profiles by probe results

Measured 2026-10-04 (`claude` 2.1.289 and SDK 0.3.284 under Bun 1.4.2; `cursor-agent` 2026.09.15-d2fe57e; `devin` 3000.11.3).

**Claude (runner over SDK)** — [[6c4c410f|SDK on Bun]], [[e23e83c7|tools and settings]], [[b05a4728|mid-turn words]], [[30b86b6d|resume, fork, compact]], [[fa33bed1|spend]]:
- the SDK runs under Bun; `settingSources: []` loads no hooks, `CLAUDE.md` or skills; `tools: []` + `strictMcpConfig` leave only `tagma` tools, env of the MCP process arrives;
- `bypassPermissions`: MCP calls go with no request;
- `/compact <instructions>` runs in the same session: `compact_boundary` with `pre_tokens`/`post_tokens`, the retelling as a `user` message, cache read visible (by `modelUsage.cacheReadInputTokens` growth);
- the session JSONL file assembled outside Claude Code is taken by `resume` (checked on `user`/`assistant`; `tool_use`/`tool_result` in assembled history is the first thing the provider-switch task checks);
- spend: `result.usage` is per turn; `total_cost_usd` and `modelUsage` accumulate, a turn's spend is the difference; `rate_limit_event` once per query with `five_hour`/`seven_day` windows. Cut streaming undercounts: the turn's `usage` is zero.

**Devin** — [[15ea16b5|MCP and hooks]], [[4c350a0c|turn]], [[a9546793|model]], [[fe60d425|spend]]:
- MCP `tagma` from the project's `.devin/mcp_config.json`, `mcpServers` empty; env arrives;
- project hooks fire in ACP mode, all of them (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`) with the process env: path touch and authorship are hooks, as in the terminal;
- there is no mode where the agent asks about every changing call; the session mode is `accept-edits` (asks about commands and MCP). A file record to disk is not judged — the same boundary as terminal Devin in bypass mode;
- `request_permission` carries only `toolCallId`: the call record comes from earlier updates;
- a session busy with another process answers `-32015 session_locked`; sessions are shared with the interactive CLI (`sharedSessions`);
- a bad key drops `session/new` with `-32603` → the `harness-login` refusal;
- spend: tokens every turn (`usage_update`, `turn_stats`), price only in the `load` replay.

**Cursor** — measured, but `acp` transport is not built for it (see "What the operator gets"); the measurement stays as this decision's ground. [[7927c9e0|MCP]], [[58248ba9|calls and hooks]], [[75d8d1d1|cancel and input]], [[b0db1a2b|model]], [[4a8fa2cc|spend]], [[16b1a7be|histories]]:
- MCP `tagma` is the project's `.cursor/mcp.json` with env via `${env:TAGMA_SESSION_GRANT}`/`${env:TAGMA_SESSION_TOKEN}` references and approval via `agent mcp enable tagma` after recording the exact declaration; `mcpServers` empty (a same-name inline one raises a second process). The process environment does not inherit into MCP children;
- project hooks do **not** fire in ACP mode (in CLI the same ones fire): path touch and authorship are observation over `tool_call` with diff; file edits in `agent` mode go with no permission request, commands and MCP ask. The thread row shows: law on write and touch on read are unproven;
- `request_permission` with no `rawInput`/`locations`, the request id may be a number, `toolCallId` may hold a newline;
- model is default only; spend is neither tokens nor price (`Harness.spent` names the turns unmeasured);
- ACP and CLI sessions are separate: no `sharedSessions`, `terminal` ↔ `acp` switch goes via recap.

## Architecture

Packages and layers, bottom up.

1. **`@runlith/ndjson-rpc`.** Extends: two-way exchange, many pending requests, external ids, long-line worker.
2. **`packages/acp`.** A new module-kit with a #module card; `external-harnesses` gets an `imports` link to it. The kit holds ACP v1 subset schemas and the pure client machine. Unknown variants it yields as `unknown` with the raw body. The kit imports `ndjson-rpc`; it has no processes and no Tagma in it.
3. **`external-harnesses`.**
   - **`protocol/`** — the ACP driver, its state row and projection through the `threads` port. The driver knows no vendors.
   - **`protocol/profile.ts`** — the profile type. `HarnessAdapter.acp` references it type-only, so the adapter `entry.ts` does not load the kit at runtime.
   - **`vendors/<vendor>/acp.ts`** — Devin and Claude profiles.
   - **Sessions.** `HarnessSessions` narrows to `start`, `send`, `receive`, `stop`, `retire`, `recover`, `onWorking`. `onWorking` keeps the machine awake: `AwakePolicy` counts both drivers' going turns. One implementation truly provides it, picking the driver by `ExternalSession.transport`. Today the layer exposes the `SessionDriving` class, taken directly by `contribution.ts`, `serving.ts` (the `recover` loop), `assembly.ts` (`onWorking` → `AwakePolicy`) and `harnessSpeech`. All move to the narrowed contract.
   - **PTY only.** `adopt` and `observed` stay with the PTY driver: only terminal sessions are adopted.
   - **Owner.** One `ownerId` per server is shared by both drivers, and each driver's `standing()` filters by its transport.
   - **Argv.** The terminal argv (`harnessArgv`) moves from `HarnessSessionStore.open` into the PTY driver.
   - **Other changes:**
     - server owners of hook roles read the transport (decision 5);
     - the judge in `asks/decision.ts` splits into verdict and parking;
     - `mcpDeclaration.ts` exports the declaration value;
   - **`runner/claude/`** — the Claude runner: the `tagma harness-run claude` verb, the SDK, an ACP agent from the kit (`@runlith/acp/agent`), an in-process bridge to hosting operations. The SDK loads lazily, only in the runner process.
   - **`ThreadHosting`** (`packages/agent`) — thread hosting for the external agent loop (decision 2), hosting operations in `external-harnesses`.
4. **`threads`.**
   - **Turn-record port.** Declares the external-harness turn-record port and fills it with its journal (decision 6).
   - **Facet.** Gets `transport` and `proves` — the snapshot of what the transport proves: law, touch, authorship. `external-harnesses` writes them at birth and on transport switch, and `wireHarness` hands them to the thread row.
   - **Thread capabilities** of the external thread are read from the facet's `proves` snapshot: `fork` and `rewind` by profile (decision 10). With no snapshot — `EXTERNAL_CAPABILITIES`.
   - **Subscription.** `thread.subscribe` also serves a harness thread on `acp`: its feed is the journal.
5. **App.**
   - **Surface choice.** Choosing between `ChatSurface` and `HarnessTerminal` by the thread row's transport now lives in `View.svelte.ts`: `harnessThread`, `select`, `bind` leaves before `subscribeChat`. The file is over 650 lines and cannot grow (rule 6b3210c7). The harness thread surface picker moves into its own owning file. On `acp` a chat opens; on `terminal` — a terminal, as today.
   - **The thread row** names the transport and weakenings.

Data flows:

- **Operator word:** `Harness.send` → inbox → driver (envelope reservation and row request record) → lane → agent stdin.
- **Agent output:** stdout → host journal → driver reads from cursor → `ndjson-rpc` → `packages/acp` machine → projection through the `threads` port (boundaries) and live feed (deltas).
- **Vendor hook:** `tagma hook` → `hooks/door.ts`. On `acp` only decision 5's roles remain.
- **MCP call:** on Devin — `tagma mcp-serve` with the grant from the environment, as in the terminal; on Claude — the runner's in-process bridge → `call_hosted_tool` → the native tool door.

## Work order

Each item is a separate task; each next rests on the previous.

1. **Probes P1–P5** — done, results in decision 12. The questions below stay as the record of what they checked.
   - **P1. Claude via Agent SDK under Bun** (a minimal probe script, not yet the runner):
     - does the SDK run under Bun with the installed `claude`;
     - does its own `systemPrompt` replace the Claude Code prompt whole, and what Claude Code adds to it itself;
     - does Claude Code keep the prompt snapshot on `resume` or take the new one;
     - do all built-ins turn off, and does the model see only Tagma tools from `tagma mcp-serve` under `strictMcpConfig`;
     - are file hooks, skills and CLAUDE.md unloaded under `settingSources: []`;
     - does `resume` continue a terminal-started session;
     - `now`/`later` priorities and uuid echo on a live turn;
     - `interrupt()` on a turn and time to `result`.
   - **P2. MCP on Cursor and Devin in ACP mode:**
     - does the `tagma` server rise from the project declaration;
     - does it rise twice;
     - does the model see its tools and do they need approval;
     - does the grant reach the server.
   - **P3. Turns on Cursor and Devin:**
     - `tool_call` and `request_permission` shapes;
     - the session mode where the agent asks about every changing call;
     - do hooks fire in ACP mode and do they carry the grant;
     - `session/cancel` on a going turn;
     - a second `session/prompt` mid-turn;
     - what the agent does with a repeated answer to an already closed id;
     - does the live terminal CLI hold the session lock against `devin acp`.
   - **P4. Model:**
     - does `cursor-agent acp` take a model at launch or via `set_config_option` with no write into `~/.cursor/*`;
     - starting `--model` on `devin acp`;
     - the `thought_level` act.
   - **P5. Spend and failures:**
     - does `usage_update` arrive on Cursor and Devin on a turn with tools;
     - what the agent answers to an exhausted quota and to 401.
2. **`ndjson-rpc` and the `packages/acp` kit.**
   - Two-way exchange, long-line worker, schemas, client machine.
   - Contract unit tests of the machine:
     - continuing from the cursor;
     - both sides' pending requests;
     - answer and update order;
     - record break.
3. **Driver and transport.**
   - Typing check into held pipes via lane, and the `executions` fix if needed.
   - State row, narrowed `HarnessSessions`, shared `ownerId`, argv move.
   - Transport in facet with migration, setting, hook roles, turn-record port in `threads`.
   - Devin profile. First vendor is Devin: it has the most measured in ACP.
5. **Claude runner and its profile** with fork and rewind via SDK.
6. **`set_thread_transport` and chat for `acp` threads** — the extracted surface picker and the thread row. Claude models build the UI, per the rule.
7. **Fork and rewind on Devin** via its session storage: a shape probe on the current CLI version, then the profile.
8. **Tagma provider switch and compaction for a Claude thread on `acp`** (decisions 2 and 11): history for the runner from the Tagma journal, `acp` ↔ `native` switches both ways.

## Check

1. A `harness:devin` thread with the `acp` setting is born, takes a task and answers. The feed shows messages and tool calls, not a terminal. The turn end carries `stopReason` and spend where the agent gave it. The parent gets one report per turn.
2. Word delivery:
   - `send_message` to a free thread on `acp` leaves as one `session/prompt` and is confirmed by the agent's answer to that prompt;
   - mid-turn, words wait for the turn end on Devin or insert via steer on Claude;
   - the Stop hook in the same session delivers nothing;
   - no envelope delivered twice.
3. The operator restarts the Tagma server mid-turn of a thread on `acp`. After the start the turn continues, the feed with no holes or repeats, the standing permission request answered.
4. The agent process is killed:
   - the turn ends in failure;
   - unconfirmed envelopes shown so;
   - the next word raises the process and continues the same vendor session;
   - replay does not appear in the feed.
5. Permission requests:
   - a request the thread mode allows gets `allow_once` with no operator;
   - a request under an operator-needing rule comes out as a Tagma question, and the answer leaves for the agent with the picked `optionId`;
   - two such questions come out one by one;
   - on Claude every call is a Tagma tool, and law, touch and authorship are written by the server, as in the native thread;
   - a Devin session on `acp` never runs in the vendor's bypass mode.
6. An MCP `tagma` tool call from a thread on `acp` is attributed to that thread by grant, with no sender substitution.
8. Transport switch:
   - `set_thread_transport` moves a stopped Devin thread from `terminal` to `acp` and back in the same vendor session;
   - a thread with a live process gets the `thread-running` refusal.
9. The thread row names the transport and what it proves: law, touch, authorship.
10. Fork and rewind on Claude on `acp`:
    - fork births a child thread continuing the conversation from the fork point in a new vendor session, and the original is unchanged;
    - rewind cuts the feed and the vendor session at one turn, and the next prompt sees the agent without the dropped turns.

## Risks this work does not remove

- **Vendor extensions.** They are off-spec and may change between CLI versions. The driver reads them only as declared in `initialize`.
