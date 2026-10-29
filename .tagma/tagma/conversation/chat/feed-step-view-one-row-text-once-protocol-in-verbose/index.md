---
id: 01a15505-e84f-704a-8ac7-db7516b0175d
title: "Feed step view: one row, text once, protocol in verbose"
ord: 52
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a118f1-5f59-7eb8-856a-a0deb7bb8a8f
sources:
  - kind: file
    ref: packages/agent/src/tool/display.ts
  - kind: file
    ref: packages/chat-ui/src/ActivityStep.svelte
  - kind: file
    ref: packages/chat-ui/src/entries/ToolRow.svelte
---
**Outcome.** Every thread feed step — tool call, signal, thought, compaction, retry — reads as one row of one device. Step text is visible once. Normal mode shows the outcome in the user's words. Verbose shows protocol facts and raw input/output. A newcomer sees a clean feed; a person debugging agents flips verbose and gets everything the entry knows.

**Why.** The step view is now assembled from parts that never agreed with each other (code reading 2026-10-19):
- one text arrives in `title`, `subtitle`, and `text` of one `ToolDisplay` (`collaboration/toolCalls.ts#handed`), and `ActivityStep` and `entries/ToolRow.svelte` draw all three — the message to the agent is visible three times;
- producers cut text themselves: `agentRoster.ts#opening` at 60 characters with "…", `activity.ts#firstLabelLine` at 110 with "...", demo at 64 — with free width on the right; elsewhere in the same app there is already a width fade (`lib/shared/FadeText.svelte`);
- the step row wraps (`flex-wrap`, `break-words`) and takes two or three rows;
- under the row stands "name ⧉" — a copy of the heading name;
- protocol facts are shown to everyone: `delivery woken`, `exit 0`, `wait 2m asked`, `body 120 → 300`, `started run <id>`, models like `anthropic/claude-opus-5-5 high`, `paid by anthropic default account`;
- `opens: true` on agent messages, spawn, and `submit_work` discloses them half a screen by itself;
- "Show details" with raw input/output and a `details` table (execution, operation) sits on every step;
- on an MCP call verb and heading say one thing: "Called take_screenshot on chrome-devtools take_screenshot · chrome-devtools";
- on grep without `path` the subheading is the absolute cwd.

**Step row.** `● verb subject refinement preview · facts · state   [actions] [↗]`
- One row without wrap. The flexible part — subject, refinement, preview — shrinks and fades at the right edge, only when it truly does not fit; facts, state, actions, and the arrow never shrink.
- Only the renderer cuts text, by actual width. The producer serves the whole row and never sets "…"; the limit is only the entry cap.
- A subject agent is a chip with the thread name; the chip opens the thread. There are no separate ↗ arrows to threads. More than three addressees are three chips plus "+N".
- Refinement is `display.subtitle`: a second subject the row cannot lose without losing it ("in apps/api", "to Opus 5.5 · High", the address after redirect). It stands only in the row, not in the body.
- Preview is the first body row of the `message` kind, only while the step is collapsed.
- A signal is the same: "Message from [api] — preview", "Report from [ui]", "Interrupted by [lead]".

**Facts by exception.**
- `display.facts` is the outcome in the user's words or a deviation from expected: row and match counts, +/- of a diff, nonzero exit code, "not delivered", "no agent", "lowered to …", "unchanged", "stopped".
- `display.details` is protocol: execution, operation, run, envelope ids; normal delivery (delivered, woken, queued, stored); full provider and model ids; quota account; requested waits and lives; body sizes. Never visible anywhere in normal mode, in verbose as a table in the disclosed step with value copying.
- Call duration is visible in normal mode from 5 s, in verbose always.

**Disclosure.**
- The body shows only what the row lacks: diff, code, command and output, list, document, message text, refusal reason, failure.
- The `message` kind is prose addressed to someone (message, task, interrupt, question answer, child task, `keep` by compaction): when disclosed it is drawn as a markdown quote without a frame, and the preview leaves the row.
- An answer without a display body (`form: 'none'`) whose tool kind declares model text output (`modelText`) is disclosed as that text; a product renderer that does not recognize an answer hands it to the standard body.
- There is no "name ⧉" row. The entry address with copying and "Show details" are in verbose; without verbose "Show details" exists only on failure, refusal, unknown outcome, and interrupted input.
- A disclosed signal shows text once, without a second "From the agent" heading.

**When a step discloses itself** (as now — only in the newest segment and until collapsed): execution failure; file changes (diff, created file); answer images. Agent messages, spawn, and commit do not disclose themselves, and neither does refusal.

**Folding steps in a group** (operator, 2026-10-19).
- Three or more consecutive read steps fold, mixed: "Read 3 files · Searched 1 pattern". Two steps stay as rows: folding two saves one row but hides names and costs a click.
- Reading is a finished call whose description declares no consequences (`display.mutates` unset) and carries no own subject (not `message`, `diff`, or `binary`). The `mutates` mark is written by the producer from the tool declaration; the kit knows no tool names. That is how read, grep, glob, ls, webfetch, websearch, and graph reads fold.
- Never fold: file writes and edits, agent launches and agent messages, commits, graph writes, failure, refusal, unknown outcome, cancellation, and an interrupted call.
- While the turn runs, its group steps stand one by one; folding (and folding named thoughts) assembles when the turn ends. A row a person just read never collapses before their eyes.

**Verbose adds:** in the row — the raw tool name and duration; in the disclosed step — the `details` table, "Show details", and the entry address; in the feed — `verboseOnly` entries, as now (transport signals, guidance, context, system prompt, ready answers).

**Step kinds (normal mode).**
- Agent messages (`send_message`, `send_task`, `interrupt_agent`, `answer_approval`): "Wrote to [ui] planChange now returns…", "Gave work to [api] …", "Stopped [ui] …". Kind `message`, no `opens`; delivery, command, closed requests, compaction behind, and summarizer go to `details`; only "not delivered" and "no agent" are in view.
- `spawn_agent`: "Started [api] on Sol 6.1 · High — Return a prorated credit…". Task is `message`; profile, provider, model, switches are `details`; lowering the model is a fact.
- `set_agent_model`: "Moved [ui] to Opus 5.5 · High"; from and id are `details`; lowering is a fact.
- `stop_agent`, `continue_agent`, `compact_agent`, `rewind_agent`, `fork_thread`: chip and outcome; run, request, and summarizer are `details`.
- `bash`: "Ran Run billing tests"; `exit 0`, wait, and life are `details`; `exit 1` and endings (`life ran out`, `killed`, `not started`) are a red fact, like refusal.
- Files (`read`, `write`, `edit`, `delete`, `rename`): path, row count or +/-; without changes.
- Search (`grep`, `glob`, `ls`): pattern, "in <path>" only when the path is named and is not cwd, count.
- Web: query or address; post-redirect address is a refinement; MIME and bytes are `details`.
- Graph: block "name — title", outcome; `body a → b`, `refs`, `files` are `details`; `submit_work` does not disclose itself.
- MCP: "Called take_screenshot on chrome-devtools" — no heading repeated.
- Thread operations (`sessionDisplay`): thread and outcome; run id and service-entry counters are `details`.
- Thought: "Thought · first row" whole, with fade.
- Compaction: "Compacted the context with Opus 5.5"; in view are `unchanged`, `stopped`, `failed`, "no summarizer", and gaps; mode, measured, budget, quota, passes are verbose.
- Retry: live "Retrying in 5s · connection dropped", past "Retried · connection dropped"; attempt number is verbose.
- Folded same-kind steps: "Read 3 files · Searched 2 patterns — subjects" with fade.
- Group header "Worked for 9s · 7 steps · 1 failed" — unchanged.

**Change owners.**
- `@runlith/agent` `tool/display.ts`: the `message` kind; the `subtitle` contract (one refinement row, not body repeat); `facts`/`details` by the rule above. Read by `ToolOutput.ts#boundDisplayBody`, `transcript/cap.ts`, `chat-ui/rowEstimate.ts`.
- Producers: `agent/collaboration` (`toolCalls.ts`, `sendTools.ts`, `CollaborationTools.ts`, `historyTools.ts` — model names from `ThreadPlaneAccess.models`); `agent-tools` (bash, grep, glob, webfetch); `mcp/mcpToolCatalog.ts`; server `native-harness/voice/graphDisplay.ts`, `sessionDisplay.ts`.
- Kit `chat-ui`: `ActivityStep.svelte` (row, chip, fade, verbose), `entries/ToolRow.svelte` (body without `subtitle`, `message` kind), `activity.ts` (row without cut, signal verb + sender), `ToolXRay.svelte`, `CompactionRow.svelte`, `strings.ts` (`signal` gives the verb without a name).
- App: `features/threads/activityIdentity.ts` (no `title · subtitle` gluing), `native/strings.ts`, the demo scene `demo/scene/tools.ts` repeats the producers' new forms.

**Decisions.**
- Written history is not rewritten: steps written before the change show their previous display; the kit no longer draws `subtitle` in the body, so old messages show text twice, not three times.
- The producer's `facts`/`details` fields decide "outcome" vs "protocol", not a kit label list.
- A step row with a chip inside is a `role="button"` element, the chip a real button.

**Acceptance.**
- Lab demo scene: every step is one row at 78ch column width; agent message text is visible once collapsed and once disclosed; no producer "…"; in normal mode no `delivery`, `exit 0`, model ids, run, and execution; in verbose they are there.
- Agent messages, spawn, and `submit_work` do not disclose themselves; diff and failure do.
- `bun run typecheck` in `packages/agent`, `packages/agent-tools`, `packages/mcp`, `packages/chat-ui`, `apps/tagma/server`, `apps/tagma/app` — 0 errors; affected package tests pass.
