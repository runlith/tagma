---
id: 01a17e7d-c852-79ec-938f-deb7b828138c
title: "Codex CLI 0.164.0: a turn that ended on the subscription limit writes `task_complete` with `error.codex_error_info: usage_limit_exceeded` to the rollout and does not call Stop — probe 2026-10-27"
ord: 8
tags: ["research"]
fields:
  {
    "source": {
      "name": "Codex CLI against a local server answering 429 usage_limit_reached",
      "ref": "Codex CLI 0.164.0 (codex-darwin-arm64), codex exec; 2026-10-27"
    }
  }
edges:
  - kind: discovered-from
    to: 01a17e4c-306f-714c-94fa-573cd1c3caa1
  - kind: relates
    to: 01a11d92-f13e-70e0-a79e-313114005f86
---
Codex CLI 0.164.0, `codex exec --dangerously-bypass-hook-trust --skip-git-repo-check "Reply OK"`, 2026-10-27, one host (macOS). `CODEX_HOME` is an empty temporary directory: `config.toml` with a `fake` provider (`base_url` — local server on 127.0.0.1, `wire_api = "responses"`, `env_key`, `request_max_retries = 0`, `stream_max_retries = 0`, `supports_websockets = false`, `[features] hooks = true`) and `hooks.json` with a `UserPromptSubmit` and `Stop` logger. The local server answered every POST with 429 and body `{"error":{"type":"usage_limit_reached","message":…,"plan_type":"plus","resets_at":…}}`. ChatGPT login was not used, no requests went to OpenAI (server journal: one `POST /v1/responses`).

## Observations

- Codex printed "You've hit your usage limit. … try again at …" and exited with code 1.
- The turn's rollout: `task_started`, `token_count` with `info: null` and empty `rate_limits` (`rate_limit_reached_type: null`), then `task_complete` with `last_agent_message: null` and an `error` field: `{"message": "You've hit your usage limit. …", "codex_error_info": "usage_limit_exceeded"}`. There is no separate `error`-type `event_msg` in the rollout.
- Hooks: `UserPromptSubmit` arrived, **`Stop` never arrived**. Same in TUI: `codex --dangerously-bypass-hook-trust "Reply OK"` under PTY (`script`), work directory trusted in `config.toml` — one `UserPromptSubmit`, zero `Stop`s, the same `task_complete` with `error` in the rollout. Without `--dangerously-bypass-hook-trust` no hook arrived at all (user hooks need trust), and `[features].codex_hooks` is declared deprecated in favor of `[features].hooks`.
- In the binary strings `CodexErrorInfo` serializes as snake_case: `context_window_exceeded`, `session_budget_exceeded`, `usage_limit_exceeded`, `rate_limit_exceeded`, `server_overloaded`, `cyber_policy`, `bio_policy`, `http_connection_failed` (with `http_status_code`), `response_stream_connection_failed`, `internal_server_error` and others.

## Finding

A turn that ended on the subscription limit is closed by Codex with the same `task_complete` record as a normal one, and the refusal is carried by its `error.codex_error_info` (finding: `task_complete` with `error` is a turn end with an error in general, not only the limit's). Such a turn's end is visible only in the rollout.

## Not established

- The TUI screen after the refusal was not recorded by `script` with piped input. Reading the `rust-v0.164.0` tag source (`codex-rs/tui/src/chatwidget.rs`, `chatwidget/rate_limits.rs`, not measured) shows the following. A turn error only adds a cell to history (`add_error_message`). An empty composer draws `PLACEHOLDER = "Ask Codex to do anything"`; `SIDE_PLACEHOLDER = "Ask a follow-up question"` belongs to the side conversation. A chooser "Approaching rate limits" (switch model) may stand instead of the composer, but it is placed by a quota snapshot ≥ 90 % with no workspace credits, not by the error itself. Whether it shows on a real subscription exhaustion is unverified.
- The whole `esc to interrupt` string is not in the 0.164.0 binary (finding: the turn hint is assembled from parts).
- A real OpenAI refusal on an exhausted subscription was not reproduced: Codex classified the 429 with `usage_limit_reached` itself, by the answer body.
- Which other failures land in `task_complete`'s `error` and with what `codex_error_info`.
