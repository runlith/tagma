---
id: 01a12bd2-5048-72e0-bc6a-427cbf80f7c1
title: On the Claude Code road the model calls a tool by the bare name the prompt and tool_search answer use, and gets No such tool available
ord: 172
tags: ["reflection"]
fields:
  {
    "actual": "Claude Code refuses No such tool available: search_threads: in its list the tool is called mcp__tagma__search_threads. 4 such refusals in 2 Sonnet 5.5 threads since Oct 9, none with Opus.",
    "command": "search_threads {...} right after tool_search in the hosted claude-code thread; same for bash and read.",
    "expected": "The name the instructions and the tool_search answer call the tool is the name it executes under."
  }
---
Filed from project `runlith`.

Failures: 01a12bcb-df35-7d58-a66f-d1f149cdcd52 #12 and #14 (search_threads, two parallel calls right after tool_search), 01a12196-ee87-72ad-a4ce-d5c5e973e4cc #25 (bash) and #37 (read) — the latter two direct tools whose definitions were in the request. Sample: 5298 records from 25 claude-code provider threads since 2026-09-20.

Source: the native agent prompt and every tool answer call tools by bare names, and the tool_search answer (`AgentDeferredTools.ts`, `tools[].name`) does too. Translation to the wire name is one sentence that `servedPrompt` appends to the prompt end in `runner/claude/bridge.ts`. The native road executes the bare name (`ClaudeCodeTools.receive`), so the miss never shows there.

The refusal is written by Claude Code itself; in #12/#14 the records cannot tell a name miss from a late definition apart (see the reflection on the reveal race).
