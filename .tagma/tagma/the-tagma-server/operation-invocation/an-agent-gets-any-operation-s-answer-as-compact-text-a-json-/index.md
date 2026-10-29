---
id: 01a15eb1-1b10-757c-ac79-89ebc8d8b62b
title: An agent gets any operation's answer as compact text, a JSON document under the `json` flag; the answer shape is a door property, not the operation author remembering
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14863-b077-72ab-b6a0-485a8e1fddab
---
## Why

The agent reads a Tagma operation's answer in its own context and pays for every character. Today the answer's shape depends on the door the agent came through and on whether the operation's author remembered to declare text for it.

Measured at HEAD, one sample, a script over `collectedOperations` and `operationBodies`:

| | operations |
|---|---|
| declared | 388 |
| offered to the agent (`tool` or the `mcp` door) | 238 |
| with their own `voice` | 21 |
| with a graph or thread "family" voice | 96 |
| neither | 121 |

Of those 121, eight are `runtime: true` (`list_agents`, `send_message`, `send_task`, `answer_approval`, `interrupt_agent`, `spawn_agent`, `stop_agent`, `continue_agent`): the runtime hands them to the native agent, already as text. How many of the rest are reachable only through the MCP bridge was not counted.

Where the agent gets JSON today:

- **The native Tagma agent** and Claude on ACP: the hosted call `call_hosted_tool` goes to the same native door. Without a `voice` and without a "family", `agentToolModelOutput` hands the model JSON (`doorToolModelOutput`). The "family" voices themselves fall back to JSON on an uncovered answer: `graphToolText` (`native-harness/voice/graphTools.ts:245`) — e.g. on `read_law`; `sessionToolText` (`native-harness/voice/sessionTools.ts:49`) — the `status: rows` answer.
- **Outcomes drawn by the door itself** — JSON with any voice:
  - refusal before execution (`packages/agent/src/agent/door/ToolExecution.ts:125`);
  - a stopped, cancelled call and `wait-ended` (`:295`);
  - a background-call receipt (`:334`);
  - the approval refusal on the hosted road (`packages/agent/src/thread/run/ThreadHosting.ts:519–529`);
  - the final background-call notification over HTTP and the bridge (`invocation/detach.ts:21`, `JSON.stringify` of the whole document).
- **Terminal CLIs** — Codex, Gemini, Cursor, Grok, Devin, and Claude Code running in a terminal — go through the `tagma mcp-serve` bridge. It always hands over `JSON.stringify(body, null, 2)` (`cli/verbs/mcpServe.ts`, `answered`), even where a voice exists.
- **`tagma op <id>`** without `--json` refuses `json-required` and prints only the document.

The cause is one: the answer shape is each operation author and each path's duty. Operations change every day, and everything resting on an author's memory diverges. The answer shape must be a door property, and text a mandatory part of an operation's presentation at its owner.

## What stands after

### 1. The door contract

Every operation answer has two shapes:

- **a document** — the same answer in every door, built by `invocation`, without `_meta`;
- **a text** — a compact reading of the same answer for the agent and the human.

| door | default | on request |
|---|---|---|
| native tool (the Tagma agent, Claude on ACP) | text | `json: true` — document |
| MCP bridge (`catalog` and `proxy`) | text | `json: true` — document |
| `tagma op <id> <input>` | text | `--json` — document |
| HTTP `/api/op/:id` (the app, plugins, tests) | document | `tagma-answer: text` — text in `_meta.text` next to the document |
| live channel | document | — |

Today the native door adds the graph act's journal range (`journal`/`journalUnreadable`) to the answer (`invocation/nativeDoor.ts:243–257`), but HTTP does not. The call's journal range is counted by `invocation` for every door holding the call key, so the document is one.

### 2. The door's fields: `json` through the same mechanism as `background`

`packages/agent` already has the door field `background`: the door offers it in the schema (`offeringBackground`), strips it before entry decoding (`withoutBackground`), and passes the value to the call (`backgroundAsked`, `ToolCallOptions`). `json` becomes a second field of the same mechanism, not a second copy (rule [[dd380bf6]]):

- a shared "door fields" mechanism: offer in the schema, including in `anyOf`/`oneOf`; strip before `toolDecode`; pass the value in `ToolCallOptions`;
- the field is offered per the tool's declaration, not to everything. Tagma operations declare `json`; `bash`, `read`, foreign MCP-server and plugin tools do not get it (rule [[7a4ff805]]);
- one conflict policy for all door fields on operations: an operation entry with a field colliding with a door field is a catalog-assembly error, like an incompatible approval (`composition/operationCatalog.ts`). Today no entry has a `json` field;
- in the `proxy` bridge, the field stands inside the entry at `call_operation`, next to `background`;
- the field description is one short phrase ("true — answer with the document instead of text"); the doctrine explains the meaning.

In the CLI, `--json` already means "print the document" (`cli/verbs/op.ts`), so the flag's meaning does not change. What changes is the behavior without it: text prints instead of a refusal.

### 3. An operation's presentation at its owner

Besides the body, an operation has a **presentation**: the voice — text for the agent — and projections for the feed (`called`, `settled`). The operation's module owns them.

**The "family" as a voice source is gone.** The graph `voice` is now declared in eight modules (graph, reflections, performance, installation, settings, mcp, landing — `submit_work`, external-harnesses), the thread voice in four. But the code is one: `graphToolText` and the `GraphToolAnswer` type (`native-harness/contract/wire/toolResult.ts`) are assembled from other modules' wire, and `nativeDoor.ts` (`voiced`, `marked`) branches on `'graph' | 'thread'` — enumerating someone else's parts (rule [[edea5454]]). Instead:

- each module declares its operations' presentation next to their bodies — one per module or per operation. Only the server loads bodies and voices; the CLI and the bridge do not pull them (rule [[50520d64]]);
- the shared `graphToolText` dispatcher and the `GraphToolAnswer` type split apart by owner. Shared line helpers — a page (`toolPageText`), a block line — stay kit helpers where declared links may import them;
- the graph and thread feed projections move to their owners along with the voice, and the native door applies the already-resolved presentation without knowing modules;
- membership in `graph`, on which `settleJournalCall` (`composition/operationCatalog.ts:26`) and `NativeIds` depend, gets a name by its own meaning — a journaled graph act — and separates from the voice;
- `spoken` goes away (rule [[dd380bf6]]): `saying` and its operations move to the voice.

**A voice is an effect in the call context:**

`voice(answer, input, at) → Effect<Text, VoiceUnrendered, R>`

- `at` carries the caller and the operation id; `R` holds the call-context services: the graph dictionary, the session, the project.
- Today's native graph voice takes the calling thread's home-project dictionary (`native-harness/turns/context.ts:185`) even for a call in another project. A voice in the call context takes the act's project dictionary — this is a fix.
- `input` lets the voice draw what was asked (`cells: true` on a screen, a byte window) instead of pointing at `json`.

**A voice gets a budget.** It is the tool-output limit, beyond which the agent would not see anyway. The voice produces lines lazily and stops at the budget with a line "the answer is longer; `json` hands over the whole document". The voice sets handles before the bulky part (point 5). So render cost is bounded by construction, not by trimming after (rule [[7a910861]]). Trimming in `packages/agent` (`OutputProjection.ts`) stays as the model's guard, but it no longer bounds render cost.

**Resolution order:** the operation's own voice → its module's voice → the shared voice. A module voice must be total over its answers' responses: JSON stubs (`graphTools.ts:245`, `sessionTools.ts:49`) go away. An answer the module voice does not draw, it hands to the shared voice as explicitly "not mine", not as a JSON line.

### 4. The shared voice

A new function over `plainLines` (`platform/contract/wire/plainText.ts`). `plainLines` itself does not change: CLI printing (`platform/cli/verb.ts:85`) and block-page fields (`graph/voice/blockPage.ts:21`) read it.

- The walk runs over the answer schema (`knownAnswer`: `arms` branches, union, optional), not just over the value.
- `key: value`, nested indented, arrays as `-` lines; every scalar value prints. The shared voice never promises a value's type: `"3"` and `3` read alike; exact types come from `json`.
- `null` and `undefined` do not print; `false` and `0` print; an empty collection is `key: none`.
- The `status: ok` success-branch marker does not print; any other `status` prints.
- The bytes type (base64) is declared once — in the executions module wire, where both byte reads now live (today it is described at the use site, `executions/contract/wire/operations/terminalCatalog.ts:354`); a second user moves it down. The shared voice prints such a field as **byte-window text**:
  - valid UTF-8 as text, control characters visible (`␛[32m`);
  - an incomplete sequence at the window edge (the window cut the character) as an explicit mark with the byte count and offset, the rest of the text intact;
  - non-valid bytes inside as a count mark, surrounding text intact;
  - a window with more non-valid bytes than text as one line "N bytes, not text", with offsets and how to take them through `json`.

### 5. Text never loses the next call's handles

An own voice and a module voice may drop noise, but never handles: ids, a cursor, a revision, an offset, `next`. Otherwise the agent would call `json` just for the cursor, and the savings would vanish.

- **A handle** is the `handle` marker on the reference type's schema at its owner: an id, a page cursor, a revision, an offset. Once per type, not per field. The marker also carries the shape the owner prints the handle in: e.g. the shortened `spokenId` (`platform/contract/wire/ids.ts:18–20`) for writers in graph voices.
- **The check is a contract over declared handles, not a random sample.** For every agent operation with its own or a module voice, the check builds the answer for every known `knownAnswer` branch (not for an open future-status `arms` branch). Handle values are distinguishable tokens, unique by path and long enough. The check looks for their printed shape in the text.
  - Built over the schema through `Arbitrary.schema` (effect 4.0.1 carries it); a schema with no buildable sample gets a minimal valid sample from the owner.
  - Budget: the unit layer if it fits its 1.5 s; otherwise the integration layer by module.

### 6. Every outcome the agent sees

The agent gets text or the `json`-picked document for every outcome, not just for the executed answer:

| outcome | drawn by |
|---|---|
| answer | the voice in the call context |
| a negative answer (`negative`: the document exists, but the act did not do what was asked, e.g. a refused landing) | the voice and the outcome line |
| a refusal before execution, an approval refusal (native and hosted), a stop, a cancellation, `wait-ended` | the door in `packages/agent`, with one outcome-line function |
| a background-call receipt | the door, with the same function |
| a background call's final notification | the end words drawn by `invocation/detach.ts` in the process where the call ran, in the shape the call asked for, written into the debt line as ready text; negative ends `failed`. A call whose process died ends with fixed words about the unknown outcome — such an end has no document, so the debt line never keeps the shape |
| recovery after a restart (`settleEffect`) | the voice in the context `settleEffect` already opens (`nativeDoor.ts:287`); today `toModelOutput` gives the text there, and after the voice moves, recovered calls must not turn JSON |

Outcome words drawn by the door itself are Tagma's words, so they go as text on any tool. The `json` flag exists on them only where the tool declared it.

**The negative outcome** is told apart before the door. `invocation` already derives `negative` (`invocation/perform.ts:262–269`); HTTP puts it into `tagma-outcome`, and the CLI exits with code 1. Today the bridge hands such an answer over as success, and the native door only recognizes `status: refused` at the top level. After: the `invocation` result carries the outcome — answer, negative, refusal, defect — and native and the bridge hand negative over as a failed call (native — an unsuccess verdict, MCP — `isError: true`) with the answer text. The door must not re-derive negative from the document's fields.

### 7. Refusals are one function

Only `refusalLines` (`platform/contract/wire/refusal.ts`) draws refusal lines: `refused[code]: reason`, `said:`, `input file:`, `unblock:`. Every door and every voice calls it. Its own copies move to it:

- `cli/verbs/mcpServe.ts:20–24`;
- `cli/door.ts:45`;
- `invocation/detach.ts:6–7`;
- `ToolFailed.message` (`packages/agent/src/agent/tool.ts:187–190`);
- `sessionToolText` (`native-harness/voice/sessionTools.ts:13–15`).

Refusals that happen before `invocation` (an unknown operation, off-schema entry, `server-starting`, awaiting approval) are drawn by the door from the refusal body with the same function. An HTTP refusal has no `_meta`, so each door builds the refusal text from the body on its own. With `json` — the refusal body, as now.

### 8. A fallen voice never hides what happened

The voice draws an already-executed act's answer. If it fell (`VoiceUnrendered`), the agent must not decide the act did not happen and repeat a write. So the door answers with the document and a line that the text did not build. The catch stands inside call serving, before the outcome writes — otherwise the outcome would record a fallen one. It is a declared best-effort with a reason in the allowance config (rule [[ea465bed]]), not a swallowed failure: the act and the document survive; only the shape is lost.

### 9. Doors

- **Native** (`invocation/nativeDoor.ts`): the voice counts in the same `placement.serve` as the body and goes to the model as ready text through the existing `ToolOutputRequest.modelOutput` (`packages/agent/src/agent/door/OutputProjection.ts`). `voiced` and `marked` with their "family" branching go away.
- **`invocation`**: one call executor, which the door tells what it needs — pictures, text — not a third variant next to `performByIdIn` and `performMediaByIdIn` (`invocation/perform.ts:285–305`).
- **HTTP**: `tagma-answer: text` asks for text; the answer stays a JSON document, the text lies in `_meta.text`. Without the header no text is counted.
- **The MCP bridge** (`cli/verbs/mcpServe.ts`, `cli/mcpTools.ts`):
  - text mode: sends `tagma-answer: text` and hands over one text content, without `structuredContent` — tools declare no `outputSchema`, and MCP does not require it;
  - `json: true`: does not send the text header and hands the document over once — as text content;
  - pictures ride `tagma-media: inline`, regardless of the answer shape;
  - `list_operations` in text mode is `id — meaning` lines with a compact entry signature (`field: type`, optionals marked). The entry schema is the proxy agent's only path to "how to call `call_operation`", and it must not require `json`.
- **CLI** (`cli/verbs/op.ts`): without `--json` sends the header and prints `_meta.text`; with `--json` prints the document. The `json-required` refusal goes away. The exit code over `tagma-outcome` does not change.

### 10. Own voices first for the most frequent reads

The shared voice covers everything, but frequent reads in their own shape are far shorter. The first batch is the terminal and command reads this started with:

- **`read_terminal_screen`** — a header (size, cursor, buffer, modes changed from default, window title), then screen lines as one block: no empty tail, wrapped lines glued, trailing spaces cut. With `cells: true` — a compact per-line style description, not a pointer to `json`.
- **`read_terminal`, `read_command`, `wait_command`, `wait_terminal`** — a status line and fact lines.
- **`read_terminal_bytes`, `read_command_bytes`** — the range and the byte-window text per point 4.

Further — by call count from thread history: the implementer counts them with a request over thread records and attaches the table to the task.

Eight `runtime: true` operations are handed to the native agent by the runtime (`packages/agent/src/collaboration/CollaborationTools.ts`), already as text. Their presentation is one function: the operation voice in the threads module draws with the same helper as the runtime tool, without a second rendering of the domain fact (rule [[51c66cb6]]). `json` on the runtime tool hands over the operation document.

### 11. Texts seen by agents and authors

The same change fixes (rule [[d82432e6]]):

- the doctrine: `threads/doctrine/operationsSection.ts`, `graph/doctrine/graphReading.ts:9`, the `threads/doctrine/sectionText.ts` check and its test;
- `installation/operations/downgrade.ts:70`;
- help and `unblock` in `cli/verbs/op.ts` (`:92`, `:104`, `:133`);
- the `plugins` skill — the plugin author sees the `tagma-answer` header (rule [[7cb3c1cf]]).

Everywhere one formula: text by default, `json` / `--json` — the document.

## Owners

- `apps/tagma/server/src/invocation` ([[be68a750]]) — presentation resolution, rendering in the call context, one executor, the outcome, the journal range for every door, the native door, `detach.ts`.
- `apps/tagma/server/src/platform/contract` — `body.ts` and `routed.ts` (presentation, removing `spoken`), `service/manifest.ts` and `wire/manifest.ts` (without the voice "family"), `wire/plainText.ts` (the shared voice next to `plainLines`), `wire/refusal.ts`.
- `apps/tagma/server/src/composition` — `operationCatalog.ts` and `manifest.ts`: assembling presentations and door fields, the conflict error.
- Modules owning the "family" voices: graph, reflections, performance, installation, settings, mcp, landing, external-harnesses, threads, native-harness, change-record. `native-harness/voice/graphTools.ts` and `native-harness/contract/wire/toolResult.ts` split apart.
- `apps/tagma/server/src/http` ([[64d4c5ab]]) — the `tagma-answer` header.
- `apps/tagma/server/src/cli` ([[9e81e75e]]) — `op` and the MCP bridge.
- `apps/tagma/server/src/executions` ([[90491249]]) — the bytes type and its own terminal and command voices.
- `packages/agent` — the door-field mechanism (`tool.ts`, `ToolArguments.ts`, `ToolCallOptions`), the door's outcome texts (`door/ToolExecution.ts`, `thread/run/ThreadHosting.ts`, `thread/run/ThreadEffectSettlement.ts`), the negative outcome in the verdict.

Out of scope: runtime tools that are not operations (`bash`, `read`, `grep`, `edit`, and the like) — they already answer with text. Tagma does not redo foreign MCP-server and plugin tools (rule [[7a4ff805]]).

## Rejected

- **A flag declared by each operation.** The same author memory everything diverged on.
- **Text at the door, not in `invocation`.** Doors differ, and each would draw its own way; the voice needs the call's services, which the door does not have.
- **The "family" as a voice owner.** It has no single owner module, and centrally sorting someone else's answers breaks rule [[edea5454]].
- **`text/plain` at HTTP under a header.** The outcome, pictures, and `_meta.toolDisplay` already ride JSON; a second body format would fork parsing at every client.
- **`structuredContent` next to text in the bridge.** The document would reach the model twice or in a field each CLI shows unpredictably.
- **Only the shared voice, without own voices.** The terminal screen, a list page, a graph line are several times shorter in their own shape. The shared voice is the floor, not the ceiling.
- **JSON by default for some operations.** Then `json` has no meaning, and the agent gets no predictability.

## Order

Each step lands on its own and changes nothing the app reads.

1. **No behavior change:** model-ready text through `ToolOutputRequest.modelOutput`; presentation resolution in `invocation` on today's voices; the voice as an effect with `input`, `at`, a budget, and `VoiceUnrendered`; one executor.
2. **The door's `json` field and the shared voice together with the `handle` marker and the check** — the safety net switches on together with the change.
3. **Module presentations:** splitting `graphToolText`, feed projections at their owners, removing the voice "family", `spoken`, and JSON stubs, one refusal function.
4. **Every outcome** per point 6, including negative, hosted approval, background, and recovery.
5. **HTTP, the bridge, the CLI**, and the texts per point 11.
6. **Own voices** of the first batch, then by call count.

## Acceptance

1. The native agent, Claude on ACP, a terminal CLI through the bridge (`catalog` and `proxy`), and `tagma op` get text by default and a document with `json` / `--json`. Each door's test checks this on an operation with its own voice, with a module voice, on the shared voice, and on `runtime: true`, and on the outcomes: a refusal after execution, a refusal before execution, an approval refusal (native and hosted), negative, a background receipt and final notification, recovery after a restart.
2. HTTP without the header answers with the same document as now, plus the journal range on graph acts; `tagma-outcome` and the CLI exit code do not change; with `tagma-answer: text` the document carries `_meta.text`.
3. Catalog assembly refuses on an entry with `json` or `background`.
4. A proxy agent walks the "find an operation → learn the entry → call" path without `json`.
5. The handle check passes for every agent operation with its own or a module voice, on every known branch.
6. No voice answers with a JSON line: the previously reachable stubs (`read_law`, the thread `rows` answer) draw; `invocation` imports no module voices; `nativeDoor.ts` has no "family" branching; there is no `spoken` field; line copies of refusals are replaced with `refusalLines`.
7. A fallen voice hands over a document with a failure line, and the call outcome is recorded as having happened.
8. A byte window that cut a multibyte character reads as text with an edge mark.
9. A voice longer than the budget stops at the budget without building the whole text; checked on a large permitted document (`read_thread_agent` with a long body).
10. A measurement, one sample on this machine, in characters and tokens:
    - answer size before and after on `read_terminal_screen`, `read_command`, one graph read (native), and `read_terminals` (through the bridge);
    - native-agent and bridge tool-list size before and after adding `json`.
11. The typecheck and the tests of `invocation`, `http`, `cli`, `executions`, `native-harness`, `graph`, `threads`, and `packages/agent` pass. CLI system tests (`documents.stest.ts`, `mcpDeclaration.stest.ts`, and neighbors) read the document with `--json`, as before.
