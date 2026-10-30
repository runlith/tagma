---
id: 01a10580-ca09-72c0-a6f9-b0f507a7739c
title: "Claude Agent SDK: stream-json process, messages, input, interrupt, sessions and the live 0.3.284 / CLI 2.1.289 probe"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "Claude Agent SDK TypeScript: package, docs and live probe",
      "ref": "@anthropic-ai/claude-agent-sdk 0.3.284 (sdk.d.ts, sdk.mjs, manifest.json); CLI 2.1.289; https://code.claude.com/docs/en/agent-sdk/overview and linked streaming/sessions/typescript pages; 2026-10-04; probe/events.jsonl in the research-claude thread scratch"
    }
  }
---
Reading of 2026-10-04. **P** — own probe; **T** — `sdk.d.ts`; **K** — `sdk.mjs`; **D** — docs. The `@anthropic-ai/claude-agent-sdk` 0.3.284 wrapper (npm latest at reading time 0.3.289); the package carries Claude Code 2.1.284 via a platform optional package (darwin-arm64: 226 MB binary). Probe with installed `~/.local/bin/claude` 2.1.289, no SDK install and no Tagma change.

## Launch and session life

**K**: `query()` spawns a `claude --output-format stream-json --verbose --input-format stream-json …` process, adding flags per options (`--resume=`, `--continue`, `--fork-session`, `--include-partial-messages`, `--permission-prompt-tool stdio` with `canUseTool`, `--mcp-config`, `--setting-sources=`). The SDK uses Claude Code print mode, not the TUI. It records `CLAUDE_CODE_ENTRYPOINT=sdk-ts` into the environment if unset. `options.env` REPLACES the environment wholesale: inheritance needs `...process.env` (T). `pathToClaudeCodeExecutable` picks the installed binary; `spawnClaudeCodeProcess` allows launching it in a container/VM; `startup()` and `prewarm()` (alpha) prelaunch the process.

Streaming input is `prompt: AsyncIterable<SDKUserMessage>`; the process lives while the stream is open. A string in `prompt` is one-shot mode; control methods (`interrupt`, `setModel`, `setPermissionMode`, `streamInput`…) are available by types only in streaming input. **P**: after `result`, closing the generator ended the iterator in 773 ms. With no input, `initializationResult()` answered in 568 ms (commands, models, account, pid, session_state, capabilities, hooks_applied), but the regular output stream is empty; `system/init` appeared only after a prompt was sent. This matters for `Harness.born/begin`: process readiness and turn start are different facts.

`result` is exactly one per turn, but informational messages may follow it (T). `queued_turn_count>0` means a next turn with no new input. `system/session_state_changed` has `idle|running|requires_action`; the adapter enables it via `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`, my probe did not set that variable.

## Mid-turn input and acceptance

`SDKUserMessage` carries `uuid`, `priority:'now'|'next'|'later'`, `shouldQuery`, `client_composed`, `origin` (T). The type does not describe priority semantics. Queued sending is documented; the `result.user_message_uuids` comment in types speaks of merging close sends into one turn and of a message being absorbed during a turn between tool rounds. From adapter code (`steer()`, not measured): `now` interrupts generation (the interrupted cycle yields its own `result`, the message goes as a second cycle); during a foreground tool the tool goes to background, and the message may join the running cycle (CLI 2.1.286). While a permission is pending, the adapter sets `later`.

`extraArgs:{'replay-user-messages':''}` returns the `SDKUserMessageReplay` echo with `isReplay:true` and the same `uuid` (as the adapter does). Replies carry `user_message_uuid(s)` — the binding to the send. I did not enable echo in the probe; a Tagma delivery conclusion does not equal a stdin record: acknowledgement must be echo/UserPromptSubmit entry or reply correlation.

`Query.interrupt()` answers `still_queued` with the `interrupt_receipt_v1` capability: these are uuids of messages that will still go. The control `interrupt` request with `cancel_queued:true` and the `cancel_async_message` request exist in the wire types, but the public `Query.interrupt()` takes NO arguments, and the read Query has no public individual-cancel method. `close()` ends the process; `abortController` cancels the query (T). These control capabilities cannot be counted as available through the public method just because the CLI declared the capability. **P**: init declared `interrupt_receipt_v1, interrupt_cancel_queued_v1, interrupt_send_now_v1, msg_lifecycle_v1` and MCP/UI capabilities.

## Resume, fork, transcript

`resume:<id>`, `continue:true` (last cwd session), `forkSession:true` with resume (new id, original stays), `resumeSessionAt:<uuid>`, protective `resumeDropsTurn`, own `sessionId` (UUID). History branches, not files. Separate functions: `forkSession()`, `listSessions()`, `getSessionMessages()`, `getSessionInfo()`, rename/tag/delete. `persistSession:false` switches recording off; `sessionStore` (alpha) mirrors the transcript to external storage with mandatory local double-recording (T).

Transcript: `~/.claude/projects/<encoded-absolute-cwd>/<session_id>.jsonl` or `$CLAUDE_CONFIG_DIR/projects`; the cwd name replaces non-alphanumerics with `-` (a long name shortens with a hash). **P**: the path arrived in every hook entry, the file 109 KB after one turn. Name and place match terminal Claude Code, but file compatibility with the Tagma reader was not verified here. `CLAUDE_CONFIG_DIR` also changes the record key in the macOS Keychain: another directory reads another login (D authentication), so the transcript directory cannot be arbitrarily changed assuming login persists.

## Events

`SDKMessage` unites about 40 forms (T, line 5269): `assistant` (full message with text/thinking/tool_use), `user` (tool_result), `stream_event`, `result`, system/init/status/compact_boundary/hook_*/task_*/session_state_changed, tool_progress, rate_limit_event, api_retry, permission_denied and more. Types advise ignoring unfamiliar forms.

`includePartialMessages:true` yields raw Messages API events: message_start, content_block_start/delta/stop, message_delta, message_stop. These are streaming deltas, not a one-event-per-token promise. **P**: `text_delta:"OK"`, empty `thinking_delta` (`estimated_tokens:null`) and `signature_delta` arrived: Haiku 4.5 reasoning is not exposed as text. Tool use is a block in assistant; tool_result is a block in user, and `tool_use_result` carries the structured Output. `input_json_delta` is expected by API type, but no tools were called in the probe.

`result`: success/error, is_error (may be true even with success), stop_reason, terminal_reason, durations, ttft, result/structured_output, usage, modelUsage, total_cost_usd, permission_denials, queued_turn_count, result_index, session_id. `usage` is per turn and the main loop only; `modelUsage` and cost accumulate per query, including subagent/sidechain/compaction, but not all auxiliary calls outside the pipeline. Accumulating results must not be summed (T).

## Measured probe

One prompt "Reply with the single word OK and nothing else. Use no tools.", model `claude-haiku-4-5`, streaming input, settingSources:[], external stdio MCP process with fake env-grant. **P**: server connected; env arrived (log `GRANT=probe-grant-123`, handshake initialize → initialized → tools/list). No real Tagma grant issued and `tagma mcp-serve` not launched.

Timeline, ms from start: UserPromptSubmit 581 → init 590 → rate_limit_event 1293 → message_start 1341 → text_delta 1696 → Stop 1722 → result 1731. Result `OK`, num_turns=1, stop_reason=end_turn, terminal_reason=completed, duration_ms=1159, ttft_ms=1123, usage input=10/output=51/cache_creation=14685. total_cost_usd=0.030596 — a price-list estimate (`costBasis:list`), not a bill; accountInfo shows Claude Max and firstParty; rate_limit_event carries plan windows five_hour=0.38, seven_day=0.58 and `isUsingOverage:false`.

`includeHookEvents:true` yielded no hook_* for SDK callbacks. Registered SessionStart and SessionEnd callbacks fired in neither this turn nor an extra no-prompt launch (4 s); UserPromptSubmit and Stop fired. Docs promise these lifecycle hooks; the divergence cause is undetermined. Tagma start instructions cannot be assumed delivered by such a hook without extra verification; systemPrompt and UserPromptSubmit are separate available roads.

Scripts and raw events kept in `~/.tagma/scratch/01a1050c-9341-77f4-9341-1ec526b94c3d/probe/`: `probe.mjs`, `mcp-echo.mjs`, `events.jsonl`, `hooks.jsonl`, `mcp.log`, `noprompt.mjs/jsonl`. Email in events.jsonl replaced with `<redacted>`; other events kept. Docs — `docs-2026-10-04/` beside. The probe transcript from home removed as created by this research.

Not probed live: tools, permissions, mid-turn delivery, interrupt, resume/fork. A successful 0.3.284 wrapper run with CLI 2.1.289 is one sample, not a guarantee for all combinations.

Sources: [overview](https://code.claude.com/docs/en/agent-sdk/overview), [streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), [sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output), [TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript); package `node_modules/.bun/@anthropic-ai+claude-agent-sdk@0.3.284+1ee19f5b9977c68b/node_modules/@anthropic-ai/claude-agent-sdk/{sdk.d.ts,sdk.mjs,package.json,manifest.json,README.md}`.
