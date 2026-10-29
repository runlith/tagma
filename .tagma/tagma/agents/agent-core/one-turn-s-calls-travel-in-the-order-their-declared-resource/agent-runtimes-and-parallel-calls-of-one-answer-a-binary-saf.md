---
id: 01a15113-e4c9-763e-bcc6-16a942061194
title: "Agent runtimes and parallel calls of one answer: a binary safety flag at Claude Code and Codex, no order at LangGraph and Agents SDK, dependency is the prompt's concern at providers (2026-10-18 reading)"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "Anthropic and OpenAI docs on parallel tool use; Claude Code; Codex CLI; LangGraph ToolNode; OpenAI Agents SDK",
      "ref": "platform.claude.com/docs/en/agents-and-tools/parallel-tool-use; developers.openai.com/api/docs/guides/function-calling; claude-code-from-source.com/ch07-concurrency and the claude 2.1.296 bundle through 00a81b23; github.com/openai/codex main codex-rs/core/src/tools/parallel.rs and docs.rs tokio::sync::RwLock; langchain-ai/langgraph#8517, langgraphjs#861; openai-agents-python 0.16.0 — all read 2026-10-18"
    }
  }
---
How other agent runtimes execute several tool calls from one model answer, and what their documentation says about dependent calls. Read 2026-10-18. Observation kept apart from inference; what is unread in code named as such.

## Model providers: what they promise

- **Anthropic API** ("Parallel tool use" page). The API sets no execution order: calls may run in parallel, sequentially in arrival order, or mixed. For dependent calls the documentation offers a system-prompt line "Only batch tool calls that are independent of each other" or `disable_parallel_tool_use: true` inside `tool_choice` (then no more than one call per answer). For computer use and browser use the rule is stricter: one answer's member calls execute sequentially in arrival order, stopping at the first failure; an unexecuted call returns `tool_result` with `is_error: true`.
- **OpenAI** ("Function calling" guide). `parallel_tool_calls: false` yields zero or one call per answer. The guide says nothing about execution order or dependent calls.

Both providers leave dependency to the runtime or the prompt. A prompt lowers the rate of dependent batches but does not rule them out.

## Claude Code

- **Tagma's own reading** ([[00a81b23]], CLI 2.1.296 bundle plus live probes): an MCP tool's `isConcurrencySafe()` is `readOnlyHint ?? false`. A call without `readOnlyHint` travels alone, and calls after it await its end; calls with `readOnlyHint: true` run in parallel, even during answer streaming.
- **Third-party source reconstruction** (claude-code-from-source.com, ch. 7; not reconciled with the current bundle). `partitionToolCalls` walks calls left to right and calls `isConcurrencySafe(input)` on each: adjacent safe calls merge into a parallel batch, an unsafe one travels alone; emission order holds. An unknown tool, a parse failure, or an exception in the check means serial execution. `Read` and `Grep` are always safe, `Edit`/`Write` never, `Bash` only when the command parses as read-only. Up to 10 simultaneous calls (`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`). `StreamingToolExecutor` launches a call during streaming when nothing runs or the newcomer is safe and all running ones are safe.

Result: a binary per-call flag (safe or not), default unsafe, order between the unsafe and its neighbors held by the split.

## Codex CLI

`codex-rs/core/src/tools/parallel.rs` on `main` read (openai/codex, 2026-10-18).
- `ToolCallRuntime` holds `Arc<tokio::sync::RwLock<()>>`. A tool supporting parallelism (`router.tool_supports_parallel`) takes a read guard, the rest a write guard held until the dispatch ends. `ToolExecutor::supports_parallel_tool_calls` defaults to `false`.
- Tokio's RwLock is fair per documentation: a FIFO queue, no read issued while earlier writes stand.
- **Conclusion:** the guard is taken inside an already launched task (`tokio::spawn` before capture), so emission order between an exclusive call and earlier ones holds only while tasks reach the lock in launch order; the code does not guarantee it.
- MCP: the server's `supports_parallel_tool_calls` flag (PR #17667) makes all that server's tools parallel; per a secondary source (codex.danielvaughan.com), tools with `readOnlyHint` are parallel from v0.134. That code road is unread.

## LangGraph `ToolNode`

The async road executes all calls with one `asyncio.gather`, the sync road with `executor.map` in a thread pool; results travel in call order, execution order is unguaranteed. Issue langgraphjs#861 asks for a sequential mode stopping on failure; issue langgraph#8517 says `max_concurrency` is ignored on the async road. Source is issues and the API reference, not a code read.

## OpenAI Agents SDK (Python)

Per documentation and 0.16.0 release notes: all local function calls of one answer start at once, output keeps call order; `RunConfig(tool_execution=ToolExecutionConfig(max_function_tool_concurrency=N))` caps simultaneity but adds no dependency order; that is separate from `ModelSettings.parallel_tools`. Code unread.

## What follows for Tagma

- No runtime read orders calls by the resources they touch. The best of them — Claude Code — holds order with a binary flag and a safe default; Codex with the same flag through a fair RwLock; LangGraph and the Agents SDK hold no order at all.
- A binary flag is correct but serializes independent writes (two edits of different files travel as one). Declared resources refine the same rule: with them the independent travel in parallel, and a tool without a declaration receives exactly that binary default.

## What the reading does not establish

- Current Claude Code code reconciled only for MCP tools' `readOnlyHint` (00a81b23); the rest is third-party reconstruction.
- The `readOnlyHint` road in Codex and Agents SDK execution are unread in code.
- Devin, Cursor, Gemini CLI, and Grok behavior on parallel calls is unstudied.
