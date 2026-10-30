---
id: 01a14b9f-6b94-75cf-989e-01375d27ec30
title: "Codex CLI: interrupt keeps the prompt, an unfinished text item does not enter the next request, backtrack cuts history before the turn — reading 09bced5"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "OpenAI Codex CLI, Rust core and TUI: interrupt, streaming, tool cancellation, backtrack and pending input",
      "ref": "https://github.com/openai/codex @ 09bced5ad95069494aa5a2da49c77a50a317a9b1 (2026-10-02); checkout /opt/workspaces/runlith/.external/codex; reading 2026-10-17"
    }
  }
edges:
  - kind: relates
    to: 01a11d92-f111-703b-a5d3-e97744dbe4a8
  - kind: relates
    to: 01a11d92-f13e-70e0-a79e-313114005f86
---
An existing read-only checkout `/opt/workspaces/runlith/.external/codex` was read, upstream `https://github.com/openai/codex`, commit `09bced5ad95069494aa5a2da49c77a50a317a9b1` of 2026-10-02 (`Populate thread previews from delegated task inputs (#50462)`), work tree clean. This is a Rust core and TUI reading, not a live probe of the installed CLI; the mentioned upstream tests were read but not run. Related live probes: [[44dbe4a8|interrupting Claude Code]] and [[14005f86|Codex CLI 0.159.0 interruption]]. Their results belong to the binaries named there; the results below belong only to this commit.

## 1. Interrupt before the first model output

**Code:** an admitted initial user prompt stays in model history; an ordinary interrupt neither returns it to the composer nor deletes it. The TUI tells the initial send apart from a pending steer by `render_in_history = !agent_turn_running`: the initial prompt shows at once and is not placed in `pending_steers`. `on_interrupted_turn` restores only still-waiting input. This is pinned directly by two tests `output_free_esc_interrupt_keeps_prompt_and_opens_blank_composer` and `output_free_ctrl_c_interrupt_keeps_prompt_and_opens_blank_composer` in `codex-rs/tui/src/chatwidget/tests/composer_submission.rs:1680–1739`.

In core, `run_turn` → `run_hooks_and_record_inputs` → `record_pending_input` → `record_user_prompt_and_emit_turn_item` records the admitted prompt before sampling. Input keeping is separately provided for a cancelled startup prewarm (`RegularTask::run`) and a pre-sampling compaction error (`run_turn`). The next model input builds from `clone_history().for_prompt(...)`; interrupt does no rollback of this history. Grounds: `codex-rs/core/src/session/turn.rs:163–222,368–378,515–532,866–913`, `codex-rs/core/src/hook_runtime.rs:716–738`, `codex-rs/core/src/tasks/regular.rs:40–114`, `codex-rs/tui/src/chatwidget/input_submission.rs:227,428–440,489–545`.

**Marker:** `Session::handle_task_abort` on `TurnAbortReason::Interrupted` records `<turn_aborted>…</turn_aborted>` regardless of model output, then publishes a separate `TurnAborted` event. The marker is on by default (`agents.interrupt_message`, default `true`); when off, interrupt events remain, no model-visible marker is added. The marker role is `user` under non-V2 `MultiAgentVersion`, `developer` under V2. Its meaning: the previous turn was deliberately interrupted, unified exec processes may have stayed in the background, commands may have run partially. Grounds: [`codex-rs/core/src/tasks/mod.rs`, `InterruptedTurnHistoryMarker`, `interrupted_turn_history_marker`, `Session::handle_task_abort`, lines 84–117,911–1014](https://github.com/openai/codex/blob/09bced5ad95069494aa5a2da49c77a50a317a9b1/codex-rs/core/src/tasks/mod.rs#L911); `codex-rs/core/src/context/turn_aborted.rs`, `TurnAborted`; `codex-rs/core/src/config/mod.rs:3915–3919`.

**Chain finding:** on the next ordinary request with no compaction/revert in between, the input keeps the old prompt, the marker and the new user message, plus applicable context updates. Interrupt does not mean "forget my words". This is a claim about an admitted turn: cancelling a not-yet-sent draft, hook rejection and a race to active-task creation are other states. `interrupt_task` with no active task creates no fake interrupted turn.

## 2. Interrupt during text streaming

**Code:** visible partial text and model history are different things. `OutputTextDelta` in `try_run_sampling_request` sends `AgentMessageContentDelta` to the client but records no `ResponseItem` in model history. `OutputItemAdded` creates the active UI item. Recording the message in model history happens on `OutputItemDone` via `handle_output_item_done` → `record_completed_response_item_with_finalized_facts` → `record_conversation_items`.

On cancellation the sampling loop exits with `CodexErr::TurnAborted`; its cleanup resets the parser in the UI and gathers results of already started tools, but does not turn the unfinished `active_item` into a finished assistant `ResponseItem`. Grounds: [`codex-rs/core/src/session/turn.rs`, `try_run_sampling_request`, lines 2645–2653,2699–2803,2828–2906,3013–3043,3165–3193](https://github.com/openai/codex/blob/09bced5ad95069494aa5a2da49c77a50a317a9b1/codex-rs/core/src/session/turn.rs#L2645); `emit_streamed_assistant_text_delta`, `flush_assistant_text_segments_all`, lines 2268–2330; `codex-rs/core/src/stream_events_utils.rs`, `handle_output_item_done`, lines 315–398, and `record_completed_response_item_with_finalized_facts`, lines 93–105.

The TUI keeps already received text in the current transcript: `on_interrupted_turn` → `finalize_turn` → `flush_answer_and_plan_streams`; the last flushes the stream controller and sends `ConsolidateAgentMessage`. Grounds: `codex-rs/tui/src/chatwidget/turn_runtime.rs:315–348`; `codex-rs/tui/src/chatwidget/streaming.rs:65–143`.

**Chain finding, with no wire probe:** an unfinished text item stays visible in the TUI, but its bare deltas will not enter the next model request. Assistant items with an already handled `OutputItemDone` persist even in an unfinished turn. The next request holds the recorded history prefix, the source user prompt, this turn's finished items, the marker and the new input; the unfinished streaming item is not added automatically. The separate `TurnAborted` event is a lifecycle record, not a substitute for the model-visible marker.

## 3. Tool interrupt

**Code:** a tool call is recorded before dispatch. `ToolCallRuntime::handle_tool_call_with_source` on cancellation keeps the real result if the terminal outcome is already reached or dispatch finished; otherwise it aborts dispatch and creates `AbortedToolOutput`. Its text: for the default-namespace `exec_command` — `Wall time: {secs:.1} seconds\naborted by user`, for the rest — `aborted by user after {secs:.1}s`. `AbortedToolOutput::to_response_item` keeps `call_id` and forms `function_call_output` or `custom_tool_call_output` by the source call shape; for `ToolSearch` — completed output with empty `tools`. This is no universal `is_error: true`: aborted output passes `success: None`.

Results are gathered by `drain_in_flight` and recorded in history before the abort cleanup's usual end; `<turn_aborted>` is added after them. Grounds: [`codex-rs/core/src/tools/parallel.rs`, `ToolCallRuntime::handle_tool_call_with_source`, `aborted_response`, `abort_message`, lines 249–346](https://github.com/openai/codex/blob/09bced5ad95069494aa5a2da49c77a50a317a9b1/codex-rs/core/src/tools/parallel.rs#L249); `codex-rs/core/src/tools/context.rs`, `AbortedToolOutput::to_response_item`, lines 346–375, `function_tool_response`, lines 578–602; `codex-rs/core/src/session/turn.rs`, `drain_in_flight`, lines 2483–2510; `codex-rs/core/src/stream_events_utils.rs:323–354`.

The next request with the call, synthetic abort result and marker is directly checked by the read upstream tests `interrupt_tool_records_history_entries` and `interrupt_persists_turn_aborted_marker_in_next_request` in `codex-rs/core/tests/suite/abort_tasks.rs:212–370`.

**Guarantee limit:** `handle_task_abort` gives the task only 100 ms of graceful cleanup, then aborts the handle. With no output at all, `ContextManager::for_prompt` → `normalize_history` → `ensure_call_outputs_present` adds a prompt-only `aborted` result right after the call (for ToolSearch — an empty output); that is no proof such a result was already durable in the rollout. For missing custom/local-shell outputs `error_or_panic` fires too. Grounds: `codex-rs/core/src/tasks/mod.rs:71,944–956`; `codex-rs/core/src/context_manager/history.rs:599–612,951–964`; `codex-rs/core/src/context_manager/normalize.rs:21–137`. An already launched unified exec process may keep running in the background: the marker itself warns of that; interrupt proves no rollback of side effects.

## 4. Explicit past-prompt edit and history cut

**Code:** there is a separate backtrack/prompt-edit flow. On an empty composer the first Esc prepares backtrack, the next opens the previous-prompts picker; confirming the chosen one sends RevertSessionForPromptEdit. The handler resolves the prompt to `before_turn_id`, calls `AppServerSession::revert_thread` (`thread/revert`), then returns the chosen prompt to the composer for editing. This is a separate act after interrupt, not its automatic consequence.

The cut runs **before the chosen turn's start**: the chosen user prompt, its whole assistant/tool tail and all later turns leave the active history. Cutting a mid-turn steer out on its own is impossible; the current TUI also refuses for a chosen in-progress turn and side conversation. Grounds: [`codex-rs/tui/src/app_backtrack.rs`, `handle_backtrack_esc_key`, `apply_backtrack_selection`, `backtrack_revert_before_turn_id`, lines 109–145,495–605](https://github.com/openai/codex/blob/09bced5ad95069494aa5a2da49c77a50a317a9b1/codex-rs/tui/src/app_backtrack.rs#L495); `codex-rs/tui/src/app/event_dispatch.rs:661–798`; `codex-rs/tui/src/app_server_session/history.rs:139–171`.

Backend `thread_revert_response` requires a non-ephemeral paginated thread, stops and reloads the runtime. `revert_thread::revert` creates a new rollout with a reference to the kept prefix; `paginated_fork::history_base_at_boundary(ForkBoundary::BeforeTurn)` uses the turn start's ordinal and byte offset as the exclusive boundary. The old rollout physically stays; the SQLite pointer switches to the new one. This is a conversation cut, not a secure erase and not an undo of file changes. Grounds: `codex-rs/app-server/src/request_processors/thread_processor.rs:2136–2254`; `codex-rs/thread-store/src/local/revert_thread.rs:19–151`; `codex-rs/thread-store/src/local/paginated_fork.rs:136–152`.

## 5. Input sent mid-running-turn

**Code distinguishes three states:**

- **Steer already in history:** `run_turn` takes pending input before the next sampling and calls `run_hooks_and_record_inputs`. The TUI gets a committed user item; `ChatWidget::on_committed_user_message` drops the matching `pending_steer` by `client_id`. On a later interrupt these words stay in model history like other recorded input. The echo here proves history recording, not necessarily an already completed separate model request with these words.
- **Steer not yet recorded:** core clears `TurnState.pending_input` on abort (`InputQueue::clear_pending`). The TUI still keeps it locally. On an ordinary interrupt, including the standard Ctrl+C, `on_interrupted_turn` → `drain_pending_messages_for_restore` returns pending steers, rejected steers and queued messages to the composer, with newlines and the existing draft at the end; no automatic next send.
- **Esc with pending steers:** `ChatWidget::handle_key_event` specially sets `submit_pending_steers_after_interrupt = true`, interrupts the model and, after `TurnAborted`, immediately sends the pending steers as a new turn, usually merged. Standalone queued follow-ups and the current editable draft stay in their places. Question answers keep separate envelopes. With no pending steers, queued follow-ups simply return to the composer after interrupt.

Grounds: [`codex-rs/tui/src/chatwidget/input_restore.rs`, `on_interrupted_turn`, `drain_pending_messages_for_restore`, lines 312–489](https://github.com/openai/codex/blob/09bced5ad95069494aa5a2da49c77a50a317a9b1/codex-rs/tui/src/chatwidget/input_restore.rs#L312); `codex-rs/tui/src/chatwidget/interaction.rs:204–216,510–573`; `codex-rs/tui/src/chatwidget.rs:1288–1359`; `codex-rs/core/src/tasks/mod.rs:537–565`; `codex-rs/core/src/session/input_queue.rs:316–320`; `codex-rs/core/src/session/turn.rs:419–449`. Read tests: `manual_interrupt_restores_pending_steers_to_composer`, `esc_interrupt_sends_all_pending_steers_immediately_and_keeps_existing_draft` in `codex-rs/tui/src/chatwidget/tests/review_mode.rs:782–904`; `interrupt_restores_queued_messages_into_composer` in `codex-rs/tui/src/chatwidget/tests/composer_submission.rs:2298–2331`.

## Not established

CLI, model request capture and tests of this checkout were not run. The installed binary's exact behavior, TUI on client change, provider-side keeping of the cut answer, and all interrupt races with hooks/startup are unmeasured. Esc may be taken by a popup or Vim insert escape; Ctrl+C may first be handled by the active panel, and a repeated Ctrl+C ends the CLI (`ChatWidget::on_ctrl_c`, `BottomPane::should_interrupt_running_task`). The findings above belong to a key that actually reached the active turn's interrupt, and to the next ordinary request with no separate compaction/revert.
